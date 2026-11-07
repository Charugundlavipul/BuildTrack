export const companyCategories: Record<string, string> = {
  general_contractor: 'General contractor', excavation_grading: 'Excavation & grading', site_utilities: 'Site utilities', concrete_masonry: 'Concrete & masonry', structural_steel: 'Structural steel', framing: 'Framing', carpentry: 'Carpentry', cabinetry_millwork: 'Cabinetry & millwork',
  roofing: 'Roofing', gutters: 'Gutters & drainage', waterproofing: 'Waterproofing', insulation: 'Insulation', drywall: 'Drywall', painting_coatings: 'Painting & coatings', flooring_tile: 'Flooring & tile', countertops: 'Countertops', doors_windows: 'Doors & windows', garage_doors: 'Garage doors',
  plumbing: 'Plumbing', electrical: 'Electrical', hvac: 'Heating & cooling', fire_protection: 'Fire protection', low_voltage_security: 'Low voltage & security', solar_energy: 'Solar energy', elevators_lifts: 'Elevators & lifts', appliances: 'Appliances',
  landscaping: 'Landscaping', fencing: 'Fencing', pools_spas: 'Pools & spas', pest_control: 'Pest control', final_cleaning: 'Final cleaning', waste_management: 'Waste management', third_party_inspection: 'Third-party inspection', engineering_testing: 'Engineering & testing', other: 'Other'
}
export function companyCategoryLabel(code: string) { return companyCategories[code] ?? code.replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase()) }
export function companyProfileData(form: FormData) {
  return { email: String(form.get('contact_email') ?? '').trim() || null, phone: String(form.get('phone_number') ?? '').trim() || null, address: String(form.get('physical_address') ?? '').trim() || null, ein: String(form.get('ein') ?? '').trim() || null, categories: form.getAll('categories').map(String) }
}
