import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { generateCaseToken, isValidCaseToken } from '../utils/caseToken';
import { hashEmail } from '../utils/identity';
import { scheduleTimelineAlerts } from '../queues/timelineQueue';

interface SubmitReportRequest {
    email: string;  // Victim's email for identity lookup
    subject_uin: string;
    content: string;
    incident_type: 'physical' | 'verbal' | 'psychological';
    interim_relief: string[];
    organization_id: string;
}

/**
 * Submit a new report
 * POST /api/reports
 * 
 * PRIVACY: The email field is used ONLY for looking up the victim's UIN.
 * It is NOT stored in the reports table. Only UINs, organization_id, and
 * anonymized content are persisted.
 */
export async function submitReport(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({
                error: 'Database not configured',
                message: 'Please configure Supabase credentials in server/.env'
            });
            return;
        }

        const {
            email,
            subject_uin,
            content,
            incident_type,
            interim_relief,
            organization_id
        }: SubmitReportRequest = req.body;

        // Validate required fields
        if (!email || !subject_uin || !content || !incident_type || !organization_id) {
            res.status(400).json({
                error: 'Missing required fields',
                required: ['email', 'subject_uin', 'content', 'incident_type', 'organization_id']
            });
            return;
        }

        // Validate incident type
        if (!['physical', 'verbal', 'psychological'].includes(incident_type)) {
            res.status(400).json({ error: 'Invalid incident type' });
            return;
        }

        // Lookup victim's UIN from email hash
        const emailHash = hashEmail(email);
        const { data: identityData, error: identityError } = await supabase
            .from('identity_mapping')
            .select('uin')
            .eq('email_hash', emailHash)
            .single();

        if (identityError || !identityData) {
            res.status(404).json({ error: 'User not found. Please register first.' });
            return;
        }

        const victim_uin = identityData.uin;

        // Generate unique case token
        const case_token = generateCaseToken();

        // Create the report
        const { data: report, error: reportError } = await supabase
            .from('reports')
            .insert({
                victim_uin,
                subject_uin,
                content,
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
            res.status(500).json({
                error: 'Failed to submit report',
                details: reportError.message
            });
            return;
        }

        // Schedule timeline alerts (Amber at 10 days, Red at 15 days)
        try {
            await scheduleTimelineAlerts(report.id, organization_id, new Date(report.created_at));
        } catch (alertError) {
            console.warn('⚠️ Timeline alerts not scheduled (Redis may not be available):', alertError);
        }

        // Return only the case token - this is the only time it's shown
        res.status(201).json({
            message: 'Report submitted successfully',
            case_token: report.case_token,
            created_at: report.created_at
        });

    } catch (error) {
        console.error('Report submission error:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

/**
 * Get report status by case token
 * GET /api/reports/:caseToken
 */
export async function getReportStatus(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({
                error: 'Database not configured',
                message: 'Please configure Supabase credentials in server/.env'
            });
            return;
        }

        const { caseToken } = req.params;
        const tokenString = Array.isArray(caseToken) ? caseToken[0] : caseToken;

        if (!tokenString || !isValidCaseToken(tokenString)) {
            res.status(400).json({ error: 'Invalid case token format' });
            return;
        }

        const { data: report, error } = await supabase
            .from('reports')
            .select('id, status, incident_type, created_at, closed_at')
            .eq('case_token', tokenString)
            .single();

        if (error || !report) {
            res.status(404).json({ error: 'Report not found' });
            return;
        }

        res.status(200).json({
            status: report.status,
            incident_type: report.incident_type,
            created_at: report.created_at,
            closed_at: report.closed_at
        });

    } catch (error) {
        console.error('Report status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
