// client/src/config/roles.js

export const ROLES = {
  MIS: 'MIS',       // IT Admin
  DEPW: 'DEPW',     // Engineering
  MAYOR: 'MAYOR',   // Executive
  CPDO: 'CPDO',      // Planning
  PROJECT_ENGINEER: 'PROJ_ENG' // Field Staff
};

// Metadata for UI Display and Provisioning
export const ROLE_METADATA = [
  {
    type: ROLES.MAYOR,
    label: 'City Mayor (Office of the Mayor)',
    dept: 'Office of the Mayor',
    titlePrefix: 'Hon.'
  },
  {
    type: ROLES.DEPW,
    label: 'DEPW Head (Engineering)',
    dept: 'Department of Engineering and Public Works',
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
    dept: 'Department of Engineering and Public Works',
    titlePrefix: 'Engr.'
  }
];