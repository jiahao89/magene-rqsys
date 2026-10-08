export interface TeambitionCustomField {
  _customfieldid: string;
  type?: string;
  value?: unknown;
  values?: unknown;
}

export interface TeambitionTaskRecord {
  id: string;
  unique_id?: number | null;
  content?: string | null;
  executor_id?: string | null;
  creator_id?: string | null;
  taskflow_status_id?: string | null;
  scenariofield_config_id?: string | null;
  created?: string | null;
  startdate?: string | null;
  duedate?: string | null;
  sprint_id?: string | null;
  custom_fields?: string | TeambitionCustomField[] | null;
  [key: string]: unknown;
}

export interface TeambitionFieldMap {
  [domainField: string]: string;
}

