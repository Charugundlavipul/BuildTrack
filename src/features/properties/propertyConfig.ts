import { Building2, Home, Layers3 } from 'lucide-react'

export const propertyLabels = {
  divisions: { title: 'Divisions', singular: 'division', description: 'Organize operating areas and the neighborhoods within them.', icon: Layers3 },
  neighborhoods: { title: 'Neighborhoods', singular: 'neighborhood', description: 'Manage communities, division assignments, and their homes.', icon: Building2 },
  homes: { title: 'Homes & lots', singular: 'home', description: 'Maintain lot records, addresses, floor plans, and home locations.', icon: Home }
}

export { useAdminSession as usePropertySecurity } from '../admin/sessionSecurity'
