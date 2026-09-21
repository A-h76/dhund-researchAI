/** Known connector identifiers. P1a ships arXiv only; others are reserved for P1b. */
export const CONNECTOR_IDS = {
  arxiv: 'arxiv',
  pubmed: 'pubmed',
  biorxiv: 'biorxiv',
  medrxiv: 'medrxiv',
  chemrxiv: 'chemrxiv',
  chembl: 'chembl',
  clinicaltrials: 'clinicaltrials',
  pdb: 'pdb',
} as const;

export type ConnectorId = (typeof CONNECTOR_IDS)[keyof typeof CONNECTOR_IDS];

export const P1A_CONNECTOR_IDS = [CONNECTOR_IDS.arxiv] as const;

export type P1aConnectorId = (typeof P1A_CONNECTOR_IDS)[number];
