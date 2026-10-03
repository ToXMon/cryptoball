const fs=require("fs");
const {Connection,Keypair,PublicKey,SystemProgram,Transaction,TransactionInstruction}=require("@solana/web3.js");
const LOADER=new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const payer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME+"/.tape/cryptoball-deploy.json","utf8"))));
const bufKp=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/tmp/faucet-buffer.json","utf8"))));
const so=fs.readFileSync("target/deploy/cryptoball.so");
const slice=so.subarray(0,850), off=0;
const sleep=(m)=>new Promise(r=>setTimeout(r,m));
function varint(n){const b=[];for(;;){const x=n&0x7f;n>>>=7;if(n===0){b.push(x);return b}b.push(x|0x80)}}
const enc={
 "u32var+u32off+u32len":[()=>{const d=Buffer.alloc(12+slice.length);d.writeUInt32LE(1,0);d.writeUInt32LE(off,4);d.writeUInt32LE(slice.length,8);slice.copy(d,12);return d}],
 "u32var+u32off+u64len":[()=>{const d=Buffer.alloc(16+slice.length);d.writeUInt32LE(1,0);d.writeUInt32LE(off,4);d.writeBigUInt64LE(BigInt(slice.length),8);slice.copy(d,16);return d}],
 "u32var+u32off+varlen":[()=>Buffer.concat([Buffer.from([1,0,0,0]),(()=>{const d=Buffer.alloc(4);d.writeUInt32LE(off,0);return d})(),Buffer.from(varint(slice.length)),slice])],
 "be_u32+u32be_off+u32be_len":[()=>{const d=Buffer.alloc(12+slice.length);d.writeUInt32BE(1,0);d.writeUInt32BE(off,4);d.writeUInt32BE(slice.length,8);slice.copy(d,12);return d}],
 "all_varint":[()=>Buffer.concat([Buffer.from([...varint(1),...varint(off),...varint(slice.length)]),slice])],
 "u16var+u32off+u32len":[()=>{const d=Buffer.alloc(10+slice.length);d.writeUInt16LE(1,0);d.writeUInt32LE(off,2);d.writeUInt32LE(slice.length,6);slice.copy(d,10);return d}],
};
(async()=>{
 const c=new Connection("https://api.devnet.solana.com","confirmed");
 for(const [name,entry] of Object.entries(enc)){
  const fn = entry[0];
  const ix=new TransactionInstruction({programId:LOADER,keys:[{pubkey:bufKp.publicKey,isSigner:false,isWritable:true},{pubkey:payer.publicKey,isSigner:true,isWritable:false}],data:fn()});
  const bh=await c.getLatestBlockhash();
  const t=new Transaction({feePayer:payer.publicKey,recentBlockhash:bh.blockhash}).add(ix);
  t.feePayer=payer.publicKey;t.recentBlockhash=bh.blockhash;t.sign(payer);
  let sig,err=null;
  try{sig=await c.sendRawTransaction(t.serialize(),{skipPreflight:true})}catch(e){err=e.message.split("\n")[0]}
  let st=null;
  if(sig){await sleep(4000);try{const r=await c.getSignatureStatuses([sig]);st=r.value[0]}catch{}}
  console.log(name.padEnd(28), err?("SEND-ERR "+err):(st?(st.err?"CHAIN-ERR "+JSON.stringify(st.err):"OK "+sig):"no-status"));
  if(st&&!st.err)break;
  await sleep(2500);
 }
})().catch(e=>console.log("ERR",e.message));
