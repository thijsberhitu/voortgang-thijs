import {randomBytes,scryptSync} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';

const path=new URL('../data-private/deployment-secrets.json',import.meta.url);
const secrets=JSON.parse(readFileSync(path,'utf8'));
if(secrets.ADMIN_PASSWORD_HASH)throw new Error('Er bestaat al een beheerderswachtwoord.');
const password=randomBytes(18).toString('base64url'),salt=randomBytes(16).toString('hex');
secrets.ADMIN_PASSWORD=password;
secrets.ADMIN_PASSWORD_HASH=salt+':'+scryptSync(password,salt,64).toString('hex');
writeFileSync(path,JSON.stringify(secrets,null,2)+'\n',{mode:0o600});
