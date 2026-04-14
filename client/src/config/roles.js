
export const ROLES = {
  MIS: 'MIS',
  HCSD: 'HCSD',
  MAYOR: 'MAYOR',
  CPDO: 'CPDO',
  PROJECT_ENGINEER: 'PROJ_ENG'
};

export const ROLE_METADATA = [
  {
    type: ROLES.MAYOR,
    label: 'City Mayor (Office of the Mayor)',
    dept: 'Office of the Mayor',
    titlePrefix: 'Hon.'
  },
  {
    type: ROLES.HCSD,
    label: 'Head of Construction Services Division (HCSD)',
    dept: 'Construction Services Division, DEPW',
    titlePrefix: 'Engr.'
  },
  {
    type: ROLES.CPDO,
    label: 'CPDO Head (Planning)',
    dept: 'City Planning and Development Office',
    titlePrefix: 'EnP.'
  },
  {
    type: ROLES.PROJECT_ENGINEER,
    label: 'Project Engineer',
    dept: 'Construction Services Division, DEPW',
    titlePrefix: 'Engr.'
  }
];
