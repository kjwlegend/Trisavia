// Public numbers are display references, never authentication or API identity.
export function readPublicId(value,kind='A'){return typeof value==='string'&&new RegExp(`^${kind}(?:00[1-9]|0[1-9]\\d|[1-9]\\d{2,})$`).test(value)?value:null;}
export const publicIdLabel=(value,kind='A')=>readPublicId(value,kind)||'编号待分配';
export const residentPath=value=>readPublicId(value)?`/residents/${encodeURIComponent(value)}`:null;
