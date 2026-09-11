import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {libraryStore, validateSave} from '../lib/library-store.ts';
import {LibrarySync} from '../lib/library-sync.ts';

const fixture = (count = 2) => ({id:crypto.randomUUID(),title:'A saved series',source:'Hello 世界 👋\nEpisode two.',episodes:Array.from({length:count},(_,i)=>({id:crypto.randomUUID(),title:`Episode ${i+1}`,passages:['Hello 世界 👋','Another passage.'],voice:'af_heart',voiceName:'Heart',engine:'neural',rate:1.25,progressIndex:1,completed:false}))});
test('D1 and R2 preserve sources, isolate owners, retry safely, and validate progress',async t=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-05-15',d1Databases:{DB:'library-tests'},r2Buckets:{BUCKET:'library-tests'},cf:false});
  try {
    const db=await mf.getD1Database('DB'), bucket=await mf.getR2Bucket('BUCKET');
    const migration=await readFile(new URL('../drizzle/0000_nervous_mystique.sql',import.meta.url),'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map(sql=>db.prepare(sql.trim())));
    const store=libraryStore(db,bucket), data=fixture();
    await t.test('save, concurrent retry, and exact source recovery',async()=>{
      await Promise.all([store.save('alice',data),store.save('alice',data)]);
      assert.equal((await store.list('alice',false,0)).items.length,1);
      const saved=await store.read('alice',data.id);
      assert.equal(saved.source,data.source);assert.deepEqual(saved.episodes.map(e=>e.passages),data.episodes.map(e=>e.passages));
      assert.equal(saved.episodes[0].rate,1.25);assert.equal(saved.episodes[0].progressIndex,1);
      await assert.rejects(store.save('alice',{...data,title:'Different'}),e=>e.status===409);
    });
    await t.test('cross-owner access fails before reading R2',async()=>{
      assert.equal((await store.list('bob',false,0)).items.length,0);
      await assert.rejects(store.read('bob',data.id),e=>e.status===404);
      await assert.rejects(store.progress('bob',data.id,data.episodes[0].id,{index:0,rate:1,completed:false,revision:0}),e=>e.status===404);
      await assert.rejects(store.archive('bob',data.id,true),e=>e.status===404);
    });
    await t.test('progress uses revisions and safely repeats a lost response',async()=>{
      const p={index:0,rate:1.5,completed:false,revision:0};
      assert.equal((await store.progress('alice',data.id,data.episodes[0].id,p)).revision,1);
      assert.equal((await store.progress('alice',data.id,data.episodes[0].id,p)).revision,1);
      await assert.rejects(store.progress('alice',data.id,data.episodes[0].id,{...p,index:1}),e=>e.status===409);
      await assert.rejects(store.progress('alice',data.id,data.episodes[0].id,{...p,index:100,revision:1}),e=>e.status===400);
      await assert.rejects(store.progress('alice',data.id,data.episodes[0].id,{...p,rate:Infinity,revision:1}),e=>e.status===400);
      const reloaded=await store.read('alice',data.id);assert.equal(reloaded.episodes[0].progressIndex,0);assert.equal(reloaded.episodes[0].rate,1.5);
    });
    await t.test('archive and restore retain the source and progress',async()=>{
      await store.archive('alice',data.id,true);assert.equal((await store.list('alice',false,0)).items.length,0);
      assert.equal((await store.list('alice',true,0)).items.length,1);
      await store.archive('alice',data.id,false);assert.equal((await store.read('alice',data.id)).source,data.source);
    });
    await t.test('maximum 200 episode series saves atomically',async()=>{
      const large=fixture(200);await store.save('alice',large);assert.equal((await store.read('alice',large.id)).episodes.length,200);
      assert.throws(()=>validateSave({...large,episodes:[...large.episodes,large.episodes[0]]}));
      assert.throws(()=>validateSave({...large,source:'x'.repeat(1_000_001)}));
    });
    await t.test('storage failures leave no visible partial save and retries recover',async()=>{
      const broken=fixture();
      await assert.rejects(libraryStore(db,{put:async()=>{throw new Error('R2 offline')}}).save('alice',broken),/offline/);
      await assert.rejects(store.read('alice',broken.id),e=>e.status===404);
      const dbFailure={prepare:db.prepare.bind(db),batch:async()=>{throw new Error('D1 offline')}};
      await assert.rejects(libraryStore(dbFailure,bucket).save('alice',broken),/offline/);
      await assert.rejects(store.read('alice',broken.id),e=>e.status===404);
      await store.save('alice',broken);assert.equal((await store.read('alice',broken.id)).source,broken.source);
    });
  } finally {await mf.dispose()}
});

test('progress sync serializes changes and retries without dropping newer state',async()=>{
  const writes=[],messages=[];let release;let first=true;
  const sync=new LibrarySync(async(_,id,p)=>{writes.push({id,...p});if(first){first=false;await new Promise(resolve=>release=resolve)}return {revision:p.revision+1}},m=>messages.push(m));
  const e=validateSave(fixture()).episodes[0];sync.register('series',[e]);
  sync.change(e.id,{index:0,completed:false,rate:1});
  sync.change(e.id,{index:1,completed:true,rate:1.5});
  assert.equal(writes.length,1);release();assert.equal(await sync.flush(),true);
  assert.equal(writes.length,2);assert.equal(writes[1].revision,1);assert.equal(writes[1].completed,true);
  assert.equal(messages.at(-1),'Progress saved');
});
test('failed progress remains pending and conflict is not blindly retried',async()=>{
  let fail=true,calls=0;
  const sync=new LibrarySync(async(_,id,p)=>{calls++;if(fail)throw Object.assign(new Error('offline'),{status:503});return {revision:p.revision+1}},()=>{});
  const e=validateSave(fixture()).episodes[0];sync.register('series',[e]);sync.change(e.id,{index:0,completed:false,rate:1});
  assert.equal(await sync.flush(),false);fail=false;assert.equal(await sync.retry(),true);assert.equal(calls,2);
  let conflicts=0;const other=new LibrarySync(async()=>{conflicts++;throw Object.assign(new Error('conflict'),{status:409})},()=>{});
  other.register('series',[e]);other.change(e.id,{index:0,completed:false,rate:1});await other.flush();await other.retry();assert.equal(conflicts,1);
});
test('lost write response retries the committed payload before later progress',async()=>{
  let server={index:1,completed:false,rate:1.25,revision:0},lost=true;
  const calls=[];
  const sync=new LibrarySync(async(_,id,p)=>{
    calls.push({...p});
    if(p.revision===server.revision){server={...p,revision:p.revision+1};if(lost){lost=false;throw new Error('Lost response')}return {revision:server.revision}}
    if(p.revision+1===server.revision&&p.index===server.index&&p.rate===server.rate&&p.completed===server.completed)return {revision:server.revision};
    throw Object.assign(new Error('Conflict'),{status:409});
  },()=>{});
  const e=validateSave(fixture()).episodes[0];sync.register('series',[e]);
  sync.change(e.id,{index:0,completed:false,rate:1});await sync.flush();
  sync.change(e.id,{index:1,completed:true,rate:1.5});assert.equal(await sync.retry(),true);
  assert.deepEqual(calls[0],calls[1]);assert.equal(server.revision,2);assert.equal(server.completed,true);assert.equal(server.rate,1.5);
});
