// Shared by the forms and the strict private-progress reader. Server validation
// remains authoritative; these checks only explain invalid input before sending.
export function normalizeUsername(value) {
  const username=String(value??'').trim().normalize('NFKC');
  if(!/^[A-Za-z0-9_]{2,32}$/.test(username))throw Object.assign(new Error('invalid_username'),{field:'username'});
  return username;
}
export function normalizeEmail(value) {
  const email=String(value??'').trim(),parts=email.split('@');
  const bad=()=>{throw Object.assign(new Error('invalid_email'),{field:'email'});};
  if(email.length>254||parts.length!==2)return bad();
  const [local,domain]=parts;
  if(local.length<1||local.length>64||!/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+$/.test(local)||local.startsWith('.')||local.endsWith('.')||local.includes('..'))return bad();
  const labels=domain.split('.');
  if(labels.length<2||labels.some(label=>label.length<1||label.length>63||!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))||!/[A-Za-z]/.test(labels.at(-1)))return bad();
  return email;
}
export function accountFields(username,email){return{username:normalizeUsername(username),email:normalizeEmail(email)};}
export function normalizeIdentifier(value){const identifier=String(value??'').trim();return identifier.includes('@')?normalizeEmail(identifier):normalizeUsername(identifier);}
