import { useState } from 'react';
import ICDashboard from '../components/ICDashboard/ICDashboard';

// Demo page - in production, these values would come from authentication
export function ICDashboardPage() {
    // Demo organization ID - replace with actual auth context
    const [organizationId] = useState('00000000-0000-0000-0000-000000000001');

    // Demo user info - replace with actual auth context
    const [currentUserUin] = useState('1234567890');
    const [currentUserRole] = useState<'presiding_officer' | 'member'>('presiding_officer');

    return (
        <ICDashboard
            organizationId={organizationId}
            currentUserUin={currentUserUin}
            currentUserRole={currentUserRole}
        />
    );
}

export default ICDashboardPage;
