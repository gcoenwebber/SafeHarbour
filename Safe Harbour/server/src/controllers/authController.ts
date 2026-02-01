import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { generateUIN, hashEmail, isValidEmail } from '../utils/identity';
import { useInviteCode } from './organizationController';

interface SignupRequest {
    email: string;
    full_name: string;
    username: string;
    role?: string;
    organization_id?: string;
    invite_code?: string;
}

/**
 * Signup Controller
 * 
 * Handles user registration by:
 * 1. Validating the input
 * 2. Hashing the user's email for blind indexing
 * 3. Generating a non-enumerable UIN
 * 4. Saving the identity mapping (email_hash -> UIN)
 * 5. Adding user to public_directory (without email)
 */
export async function signup(req: Request, res: Response): Promise<void> {
    try {
        // Check if Supabase is configured
        if (!supabase) {
            res.status(503).json({
                error: 'Database not configured',
                message: 'Please configure Supabase credentials in server/.env'
            });
            return;
        }

        const { email, full_name, role, organization_id, invite_code }: SignupRequest = req.body;

        // Validate required fields
        if (!email || !full_name) {
            res.status(400).json({
                error: 'Missing required fields',
                required: ['email', 'full_name']
            });
            return;
        }

        // Either invite_code OR (role + organization_id) must be provided
        if (!invite_code && (!role || !organization_id)) {
            res.status(400).json({
                error: 'Either invite_code OR (role + organization_id) must be provided'
            });
            return;
        }

        // Validate email format
        if (!isValidEmail(email)) {
            res.status(400).json({ error: 'Invalid email format' });
            return;
        }

        // If invite code provided, validate and get org/role from it
        let finalRole = role || 'Employee';
        let finalOrgId = organization_id;
        let icRole: string | undefined;

        if (invite_code) {
            const inviteData = await useInviteCode(invite_code);
            if (!inviteData) {
                res.status(400).json({ error: 'Invalid or expired invite code' });
                return;
            }
            finalOrgId = inviteData.organization_id;
            finalRole = inviteData.role;
            icRole = inviteData.ic_role;
        }

        if (!finalOrgId) {
            res.status(400).json({ error: 'organization_id is required' });
            return;
        }

        // Hash the email for blind indexing
        const emailHash = hashEmail(email);

        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('identity_mapping')
            .select('uin')
            .eq('email_hash', emailHash)
            .single();

        if (existingUser) {
            res.status(409).json({ error: 'User already exists' });
            return;
        }

        // Get the next sequential ID for UIN generation
        // We use a counter approach - get the current max ID and increment
        const { data: maxIdResult } = await supabase
            .from('public_directory')
            .select('id')
            .order('created_at', { ascending: false })
            .limit(1);

        // Generate a sequential ID based on timestamp + random to ensure uniqueness
        const sequentialId = Date.now() % 0xFFFFFFFF; // Keep within 32-bit range

        // Generate the non-enumerable UIN
        const uin = generateUIN(sequentialId);

        // Start a transaction-like operation
        // First, add to public_directory (without email - privacy preserving)
        const { data: directoryEntry, error: directoryError } = await supabase
            .from('public_directory')
            .insert({
                uin,
                full_name,
                role: finalRole,
                ic_role: icRole,
                organization_id: finalOrgId
            })
            .select()
            .single();

        if (directoryError) {
            console.error('Error creating directory entry:', directoryError);
            res.status(500).json({
                error: 'Failed to create user directory entry',
                details: directoryError.message
            });
            return;
        }

        const { error: mappingError } = await supabase
  .from('identity_mapping')
  .insert({
      email_hash: emailHash,
      username: username.toLowerCase(),
      uin,
      organization_id: finalOrgId
  });

        if (mappingError) {
            // Rollback: delete the directory entry if mapping fails
            await supabase
                .from('public_directory')
                .delete()
                .eq('uin', uin);

            console.error('Error creating identity mapping:', mappingError);
            res.status(500).json({
                error: 'Failed to create identity mapping',
                details: mappingError.message
            });
            return;
        }

        // Success response
        res.status(201).json({
            message: 'User registered successfully',
            user: {
                uin,
                full_name,
                role: finalRole,
                ic_role: icRole,
                organization_id: finalOrgId
            }
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

/**
 * Lookup user by email (for internal use)
 * Returns the UIN without exposing the email
 */
export async function lookupByEmail(req: Request, res: Response): Promise<void> {
    try {
        // Check if Supabase is configured
        if (!supabase) {
            res.status(503).json({
                error: 'Database not configured',
                message: 'Please configure Supabase credentials in server/.env'
            });
            return;
        }

        const { email } = req.body;

        if (!email || !isValidEmail(email)) {
            res.status(400).json({ error: 'Valid email is required' });
            return;
        }

        const emailHash = hashEmail(email);

        const { data, error } = await supabase
            .from('identity_mapping')
            .select('uin, organization_id')
            .eq('email_hash', emailHash)
            .single();

        if (error || !data) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Get full user info from public_directory
        const { data: userInfo } = await supabase
            .from('public_directory')
            .select('uin, full_name, role, organization_id')
            .eq('uin', data.uin)
            .single();

        res.status(200).json({ user: userInfo });

    } catch (error) {
        console.error('Lookup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
