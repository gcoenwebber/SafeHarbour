import { useState } from 'react';
import { MentionInput } from './MentionInput';
import { CaseTokenModal } from './CaseTokenModal';
import './SubmitReportForm.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface FormData {
    email: string;
    incident_type: 'physical' | 'verbal' | 'psychological' | '';
    content: string;
    interim_relief: string[];
    organization_id: string;
}

const INTERIM_RELIEF_OPTIONS = [
    { id: 'transfer', label: 'Transfer to different department' },
    { id: 'paid_leave', label: 'Paid leave during investigation' },
    { id: 'schedule_change', label: 'Schedule/shift change' },
    { id: 'remote_work', label: 'Remote work arrangement' },
    { id: 'other', label: 'Other relief measures' }
];

export function SubmitReportForm() {
    const [formData, setFormData] = useState<FormData>({
        email: '',
        incident_type: '',
        content: '',
        interim_relief: [],
        organization_id: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [caseToken, setCaseToken] = useState('');

    // Extract mentioned UIN from content
    const extractMentionedUIN = (content: string): string | null => {
        const mentionRegex = /@\[([^\]]+)\]\((\d{10})\)/;
        const match = content.match(mentionRegex);
        return match ? match[2] : null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        // Validate
        if (!formData.email || !formData.incident_type || !formData.content || !formData.organization_id) {
            setError('Please fill in all required fields');
            return;
        }

        const subjectUIN = extractMentionedUIN(formData.content);
        if (!subjectUIN) {
            setError('Please @mention the person you are reporting');
            return;
        }

        setIsSubmitting(true);

        try {
            const response = await fetch(`${API_BASE}/api/reports`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: formData.email,
                    subject_uin: subjectUIN,
                    content: formData.content,
                    incident_type: formData.incident_type,
                    interim_relief: formData.interim_relief,
                    organization_id: formData.organization_id
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to submit report');
            }

            // Show success modal with case token
            setCaseToken(data.case_token);
            setShowModal(true);

            // Reset form
            setFormData({
                email: '',
                incident_type: '',
                content: '',
                interim_relief: [],
                organization_id: ''
            });

        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReliefChange = (reliefId: string) => {
        setFormData(prev => ({
            ...prev,
            interim_relief: prev.interim_relief.includes(reliefId)
                ? prev.interim_relief.filter(r => r !== reliefId)
                : [...prev.interim_relief, reliefId]
        }));
    };

    return (
        <div className="submit-report-container">
            <div className="form-header">
                <h1>Submit a Report</h1>
                <p>Your report will be handled confidentially under POSH guidelines</p>
            </div>

            <form onSubmit={handleSubmit} className="report-form">
                {error && (
                    <div className="error-message">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        {error}
                    </div>
                )}

                <div className="form-group">
                    <label htmlFor="email">Your Email *</label>
                    <input
                        type="email"
                        id="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="Enter your registered email"
                        required
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="organization_id">Organization ID *</label>
                    <input
                        type="text"
                        id="organization_id"
                        value={formData.organization_id}
                        onChange={(e) => setFormData({ ...formData, organization_id: e.target.value })}
                        placeholder="Enter organization UUID"
                        required
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="incident_type">Incident Type (POSH Category) *</label>
                    <select
                        id="incident_type"
                        value={formData.incident_type}
                        onChange={(e) => setFormData({ ...formData, incident_type: e.target.value as FormData['incident_type'] })}
                        required
                    >
                        <option value="">Select incident type</option>
                        <option value="physical">Physical Harassment</option>
                        <option value="verbal">Verbal Harassment</option>
                        <option value="psychological">Psychological Harassment</option>
                    </select>
                </div>

                <div className="form-group">
                    <label>Report Details *</label>
                    <p className="field-hint">Use @ to mention the person you are reporting</p>
                    <MentionInput
                        value={formData.content}
                        onChange={(value) => setFormData({ ...formData, content: value })}
                        placeholder="Describe the incident. Type @ to mention the person involved..."
                        organizationId={formData.organization_id}
                    />
                </div>

                <div className="form-group">
                    <label>Request Interim Relief (Optional)</label>
                    <p className="field-hint">Select any interim measures you would like during the investigation</p>
                    <div className="relief-options">
                        {INTERIM_RELIEF_OPTIONS.map(option => (
                            <label key={option.id} className="relief-option">
                                <input
                                    type="checkbox"
                                    checked={formData.interim_relief.includes(option.id)}
                                    onChange={() => handleReliefChange(option.id)}
                                />
                                <span className="checkbox-custom"></span>
                                <span>{option.label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <button type="submit" className="submit-button" disabled={isSubmitting}>
                    {isSubmitting ? (
                        <>
                            <span className="spinner"></span>
                            Submitting...
                        </>
                    ) : (
                        'Submit Report'
                    )}
                </button>
            </form>

            <CaseTokenModal
                isOpen={showModal}
                caseToken={caseToken}
                onClose={() => setShowModal(false)}
            />
        </div>
    );
}

export default SubmitReportForm;
