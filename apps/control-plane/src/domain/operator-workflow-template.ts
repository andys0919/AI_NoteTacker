export const DEFAULT_OPERATOR_JOIN_NAME = 'Solomon - NoteTaker';

export const summaryProfiles = ['general', 'sales', 'product', 'hr'] as const;
export type SummaryProfile = (typeof summaryProfiles)[number];

export const preferredExportFormats = ['markdown', 'txt', 'srt', 'json'] as const;
export type PreferredExportFormat = (typeof preferredExportFormats)[number];

export const submissionTemplateIds = ['general', 'sales', 'product', 'hr'] as const;
export type SubmissionTemplateId = (typeof submissionTemplateIds)[number];

export type OperatorWorkflowTemplate = {
  id: SubmissionTemplateId;
  label: string;
  description: string;
  requestedJoinName: string;
  summaryProfile: SummaryProfile;
  preferredExportFormat: PreferredExportFormat;
};

export const operatorWorkflowTemplates: OperatorWorkflowTemplate[] = [
  {
    id: 'general',
    label: '一般協作',
    description: '適合大多數內部會議與跨部門同步。',
    requestedJoinName: DEFAULT_OPERATOR_JOIN_NAME,
    summaryProfile: 'general',
    preferredExportFormat: 'markdown'
  },
  {
    id: 'sales',
    label: '業務跟進',
    description: '更聚焦客戶需求、承諾事項、報價與下次跟進。',
    requestedJoinName: 'Solomon - Sales Notes',
    summaryProfile: 'sales',
    preferredExportFormat: 'markdown'
  },
  {
    id: 'product',
    label: '產品決策',
    description: '更聚焦需求澄清、產品決策、風險與 owner。',
    requestedJoinName: 'Solomon - Product Notes',
    summaryProfile: 'product',
    preferredExportFormat: 'json'
  },
  {
    id: 'hr',
    label: 'HR 訪談',
    description: '更聚焦人事共識、待辦與敏感風險項目。',
    requestedJoinName: 'Solomon - HR Notes',
    summaryProfile: 'hr',
    preferredExportFormat: 'txt'
  }
];

export const defaultOperatorWorkflowTemplate = operatorWorkflowTemplates[0];

export const getOperatorWorkflowTemplate = (
  value?: string | null
): OperatorWorkflowTemplate =>
  operatorWorkflowTemplates.find((template) => template.id === value) ??
  defaultOperatorWorkflowTemplate;
