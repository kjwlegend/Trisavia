import net from 'node:net';
import { once } from 'node:events';
/** Loopback test transport drops only the first real COMMIT acknowledgement, never logs protocol bytes. */
export async function loseFirstCommitAcknowledgement(connectionString:string){
 const destination=new URL(connectionString),sockets=new Set<net.Socket>();let dropped=false;
 const proxy=net.createServer(front=>{
  const back=net.connect({host:destination.hostname,port:Number(destination.port)});sockets.add(front);sockets.add(back);
  let pending=false,frontBytes=Buffer.alloc(0),backBytes=Buffer.alloc(0),startup=true;
  front.on('error',()=>back.destroy());back.on('error',()=>front.destroy());front.on('close',()=>{sockets.delete(front);back.destroy();});back.on('close',()=>{sockets.delete(back);front.destroy();});
  front.on('data',chunk=>{frontBytes=Buffer.concat([frontBytes,chunk]);for(;;){if(frontBytes.length<(startup?4:5))break;const length=startup?frontBytes.readInt32BE(0):frontBytes.readInt32BE(1)+1;if(frontBytes.length<length)break;const packet=frontBytes.subarray(0,length);frontBytes=frontBytes.subarray(length);if(!startup&&packet[0]===81&&packet.subarray(5).toString().replace(/\0$/,'')==='COMMIT'&&!dropped)pending=true;startup=false;back.write(packet);}});
  back.on('data',chunk=>{backBytes=Buffer.concat([backBytes,chunk]);for(;;){if(backBytes.length<5)break;const length=backBytes.readInt32BE(1)+1;if(backBytes.length<length)break;const packet=backBytes.subarray(0,length);backBytes=backBytes.subarray(length);if(pending&&packet[0]===67&&packet.subarray(5).toString()==='COMMIT\0'){dropped=true;front.destroy();back.destroy();break;}front.write(packet);}});
 });
 proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const address=proxy.address() as net.AddressInfo,proxied=new URL(destination);proxied.hostname='127.0.0.1';proxied.port=String(address.port);proxied.searchParams.set('sslmode','disable');
 return {connectionString:proxied.toString(),get dropped(){return dropped;},async close(){for(const socket of sockets)socket.destroy();proxy.close();await once(proxy,'close');}};
}
