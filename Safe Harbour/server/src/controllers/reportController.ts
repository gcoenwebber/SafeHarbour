import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { generateCaseToken, isValidCaseToken } from '../utils/caseToken';
import { hashEmail } from '../utils/identity';
import { scheduleTimelineAlerts } from '../queues/timelineQueue';

/* -------------------------------------------------------------------------- */
/*                                    TYPES                                   */
/* -------------------------------------------------------------------------- */

interface SubmitReportRequest {
    email: string;
    content: string;
    incident_type: 'physical' | 'verbal' | 'psychological';
    interim_relief?: string[];
    organization_id: string;
}

/* -------------------------------------------------------------------------- */
/*                               HELPER FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

/**
 * Extract unique @usernames from content
 */
function extractUsernames(content: string): string[] {
    const regex = /@([a-zA-Z0-9_]+)/g;
    const matches = [...content.matchAll(regex)];
    return [...new Set(matches.map(m => m[1]))];
}

/**
 * Replace @username with SUBJECT_n aliases
 */
function anonymizeContent(
    content: string,
    usernameAliasMap: Map<string, string>
): string {
    let anonymized = content;

    for (const [username, alias] of usernameAliasMap.entries()) {
        const regex = new RegExp(`@${username}\\b`, 'g');
        anonymized = anonymized.replace(regex, alias);
    }

    return anonymized;
}

/* -------------------------------------------------------------------------- */
/*                                SUBMIT REPORT                                */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/reports
 */
export async function submitReport(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const {
            email,
            content,
            incident_type,
            interim_relief,
            organization_id
        }: SubmitReportRequest = req.body;

        /* ------------------------------ Validation -------------------------- */

        if (!email || !content || !incident_type || !organization_id) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        if (!['physical', 'verbal', 'psychological'].includes(incident_type)) {
            res.status(400).json({ error: 'Invalid incident type' });
            return;
        }

        /* ------------------------ Resolve victim identity ------------------- */

        const emailHash = hashEmail(email);

        const { data: victimIdentity, error: victimError } = await supabase
            .from('identity_mapping')
            .select('uin')
            .eq('email_hash', emailHash)
            .single();

        if (victimError || !victimIdentity) {
            res.status(404).json({
                error: 'User not found. Please register first.'
            });
            return;
        }

        const victim_uin = victimIdentity.uin;

        /* ------------------------ Extract accused usernames ----------------- */

        const usernames = extractUsernames(content);

        let subject_uins: string[] = [];
        let finalContent = content;

        /* -------- Resolve accused usernames (if any are mentioned) ---------- */

        if (usernames.length > 0) {
            const { data: accusedIdentities, error: accusedError } =
                await supabase
                    .from('identity_mapping')
                    .select('username, uin')
                    .in('username', usernames);

            if (accusedError || !accusedIdentities) {
                res.status(500).json({
                    error: 'Failed to resolve accused identities'
                });
                return;
            }

            if (accusedIdentities.length !== usernames.length) {
                const found = accusedIdentities.map(a => a.username);
                const missing = usernames.filter(u => !found.includes(u));

                res.status(404).json({
                    error: 'Some accused users not found',
                    missing
                });
                return;
            }

            const usernameAliasMap = new Map<string, string>();

            accusedIdentities.forEach((identity, index) => {
                const alias = `SUBJECT_${index + 1}`;
                usernameAliasMap.set(identity.username, alias);
                subject_uins.push(identity.uin);
            });

            finalContent = anonymizeContent(content, usernameAliasMap);
        }

        /* ------------------------------ Create report ----------------------- */

        const case_token = generateCaseToken();

        const { data: report, error: reportError } = await supabase
            .from('reports')
            .insert({
                victim_uin,
                subject_uins,
                content: finalContent,
                incident_type,
                interim_relief: interim_relief || [],
                organization_id,
                case_token,
                status: 'pending'
            })
            .select('id, case_token, created_at')
            .single();

        if (reportError) {
            console.error('Report submission error:', reportError);
            res.status(500).json({ error: 'Failed to submit report' });
            return;
        }

        /* ------------------------ Schedule timeline alerts ------------------ */

        try {
            await scheduleTimelineAlerts(
                report.id,
                organization_id,
                new Date(report.created_at)
            );
        } catch (alertError) {
            console.warn(
                '⚠️ Timeline alerts not scheduled:',
                alertError
            );
        }

        /* ------------------------------ Response ---------------------------- */

        res.status(201).json({
            message: 'Report submitted successfully',
            case_token: report.case_token,
            created_at: report.created_at
        });

    } catch (error) {
        console.error('Submit report error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/* -------------------------------------------------------------------------- */
/*                              GET REPORT STATUS                              */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/reports/:caseToken
 */
export async function getReportStatus(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { caseToken } = req.params;
        const token = Array.isArray(caseToken) ? caseToken[0] : caseToken;

        if (!token || !isValidCaseToken(token)) {
            res.status(400).json({ error: 'Invalid case token format' });
            return;
        }

        const { data: report, error } = await supabase
            .from('reports')
            .select('status, incident_type, created_at, closed_at')
            .eq('case_token', token)
            .single();

        if (error || !report) {
            res.status(404).json({ error: 'Report not found' });
            return;
        }

        res.status(200).json(report);

    } catch (error) {
        console.error('Get report status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

