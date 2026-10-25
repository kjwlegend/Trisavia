import jpeg from 'jpeg-js';
import {fail} from '../common/errors.ts';
import {AVATAR_ASSET_LIMITS as L} from './types.ts';
import {avatarSha256,decodeAvatarPng,type DecodedAvatarFile} from './validation.ts';
export function decodeAvatarReference(name:unknown,raw:unknown):DecodedAvatarFile{
 if(name==='reference.png')return decodeAvatarPng(name,raw);
 if(name!=='reference.jpg'||typeof raw!=='string'||!raw.length||raw.length>Math.ceil(L.fileBytes/3)*4||raw.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))fail('avatar_reference_invalid',422,'参考图须为reference.png或reference.jpg。',{fix:'上传真实PNG/JPEG，使用标准dataBase64。'});
 const bytes=Buffer.from(raw,'base64');if(bytes.toString('base64')!==raw||bytes.length>L.fileBytes||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)fail('avatar_reference_invalid',422,'JPEG文件格式或大小不正确。',{fix:'重新导出不超过2MiB的标准JPEG，不附加其他内容。'});
 let offset=2,width=0,height=0;while(offset+4<bytes.length){if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;const marker=bytes[offset++]!;if(marker===218||marker===217)break;const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;if([192,193,194].includes(marker)){if(length<8||bytes[offset+2]!==8)break;height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}offset+=length;}
 if(!width||!height||width>L.referenceWidth||height>L.referenceHeight||width*height>L.decodedPixels)fail('avatar_pixels_exceeded',422,'参考图片尺寸不符合限制。',{fix:'导出宽高各不超过2048的8位JPEG。'});
 try{const decoded=jpeg.decode(bytes,{useTArray:true,tolerantDecoding:false,maxResolutionInMP:L.decodedPixels/1000000,maxMemoryUsageInMB:64});if(decoded.width!==width||decoded.height!==height)throw new Error();return {file:{name,contentType:'image/jpeg',sha256:avatarSha256(bytes),bytes:bytes.length,width,height},bytes,pixels:Buffer.from(decoded.data)};}catch{fail('avatar_reference_invalid',422,'JPEG完整解码失败。',{fix:'重新导出标准JPEG或将图片缩小后重试。'});}
}
