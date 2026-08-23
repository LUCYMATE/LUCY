import { useState, useRef, useEffect } from 'react';
import { Upload, Trash2, Box, Activity, AlertCircle, Info } from 'lucide-react';
import { saveAsset, listAssets, deleteAsset, AssetRecord } from '../../lib/system/assetDB';
import { logger } from '../../lib/store/logger';
import { useAvatarState } from '../../lib/store/avatarState';
import { userAuth } from '../../lib/auth/userAuth';
import { useEngineStore } from '../../lib/store/engineStore';
import { emitCrossWindow } from '../../lib/events/crossWindowEventBus';

export function AssetLibrary() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [animSlug, setAnimSlug] = useState('');
  
  const flipCustomModel = useAvatarState(s => s.flipCustomModel);
  const setFlipCustomModel = useAvatarState(s => s.setFlipCustomModel);
  
  const vrmInputRef = useRef<HTMLInputElement>(null);
  const animInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    loadAssets();
  }, []);

  const loadAssets = async () => {
    try {
      const all = await listAssets();
      setAssets(all);
      
      // Update local storage so the AI prompt builder can read it immediately
      const fbxSlugs = all.filter(a => a.type === 'fbx' || a.type === 'bvh').map(a => a.id);
      localStorage.setItem('soltini_custom_animations', JSON.stringify(fbxSlugs));
    } catch (e) {
      logger.add('error', 'Asset DB', 'Failed to load assets');
    }
  };

  const handleVrmUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!userAuth.isPro()) {
      if (vrmInputRef.current) vrmInputRef.current.value = '';
      useEngineStore.getState().sendText("System instruction: The user tried to upload a custom 3D model (.VRM) in Asset Library, but they are on the Free tier. Speak directly to the user in your persona's voice! Politely and playfully let them know that uploading custom 3D avatars is a Pro feature, and they can unlock it for just $3 or ₹199/month in Settings.");
      return;
    }

    try {
      // First, delete any existing VRM models to keep only 1 custom model
      const existingVrms = assets.filter(a => a.type === 'vrm');
      for (const v of existingVrms) {
        await deleteAsset(v.id);
      }

      // Save new VRM with a fixed internal slug
      await saveAsset('custom-avatar', 'vrm', file, file.name);
      logger.add('success', 'Asset DB', 'Custom avatar updated successfully');
      
      if (vrmInputRef.current) vrmInputRef.current.value = '';
      loadAssets();

      // Notify the live avatar scene to reload with the new model immediately
      emitCrossWindow('soltini-vrm-changed');
    } catch (error) {
      logger.add('error', 'Asset DB', `Failed to upload avatar: ${error}`);
    }
  };

  const handleAnimUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !animSlug.trim()) return;

    if (!userAuth.isPro()) {
      if (animInputRef.current) animInputRef.current.value = '';
      useEngineStore.getState().sendText("System instruction: The user tried to upload a custom 3D animation (.FBX/.BVH) in Asset Library, but they are on the Free tier. Speak directly to the user in your persona's voice! Politely and playfully let them know that uploading custom animations is a Pro feature, and they can unlock it for just $3 or ₹199/month in Settings.");
      return;
    }

    const slug = animSlug.trim().toLowerCase();
    
    if (!/^[a-z0-9-]+$/.test(slug)) {
      alert('Slug can only contain lowercase letters, numbers, and dashes.');
      return;
    }

    const existingAnims = assets.filter(a => a.type === 'fbx' || a.type === 'bvh');
    if (existingAnims.length >= 4) {
      alert('You can only have up to 4 custom animations at a time. Please delete one first to save RAM.');
      return;
    }

    try {
      // Determine type based on extension
      const fileType = file.name.toLowerCase().endsWith('.bvh') ? 'bvh' : 'fbx';
      
      await saveAsset(slug, fileType, file, file.name);
      logger.add('success', 'Asset DB', `Saved animation: ${slug}`);
      
      setAnimSlug('');
      if (animInputRef.current) animInputRef.current.value = '';
      await loadAssets();

      // Notify the live AI session about the new animation so it can use it immediately
      emitCrossWindow('soltini-animation-added', { slug });
      emitCrossWindow('soltini-settings-changed');
    } catch (error) {
      logger.add('error', 'Asset DB', `Failed to save animation: ${error}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Are you sure you want to delete ${id}?`)) return;
    try {
      await deleteAsset(id);
      logger.add('success', 'Asset DB', `Deleted asset: ${id}`);
      
      // If we deleted the custom avatar, reset to default and turn off 180 flip
      if (id === 'custom-avatar') {
        logger.add('info', 'Asset DB', 'Restored default compiled model');
        setFlipCustomModel(false);
        localStorage.setItem('soltini_flip_vrm', 'false');
      }
      
      await loadAssets();
      // Notify live scene: if we deleted the avatar, reload the model; otherwise just refresh
      emitCrossWindow(id === 'custom-avatar' ? 'soltini-vrm-changed' : 'soltini-settings-changed');
    } catch (e) {
      logger.add('error', 'Asset DB', `Failed to delete asset`);
    }
  };

  const customAvatar = assets.find(a => a.type === 'vrm');
  const animations = assets.filter(a => a.type === 'fbx' || a.type === 'bvh');

  return (
    <div className="flex flex-col gap-8 w-full max-w-3xl text-white pb-12">
      <div>
        <h3 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Box className="w-6 h-6 text-pink-400" /> Asset Library
        </h3>
        <p className="text-white/60 text-sm">
          Customize your Soltini experience. Upload your own VRM model or teach the AI new animations (FBX/BVH).
        </p>
      </div>

      {/* --- AVATAR UPLOAD SECTION --- */}
      <div className="bg-black/20 border border-white/5 rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
        
        <div className="flex justify-between items-start">
          <div>
            <h4 className="font-semibold text-lg text-blue-100 flex items-center gap-2">
              <Box className="w-5 h-5 text-blue-400" /> Custom Avatar Model
            </h4>
            <p className="text-xs text-white/50 mt-1 max-w-md">
              Upload a <b>.vrm</b> file to completely change the character. You can only have 1 custom model at a time. Uploading a new one replaces the old one.
            </p>
          </div>
          
          <div className="shrink-0 flex flex-col items-end gap-2">
             <button 
                className="bg-blue-600/80 hover:bg-blue-500 text-white px-5 py-2 rounded-lg font-medium transition-colors text-sm flex items-center gap-2 shadow-lg shadow-blue-500/20"
                onClick={() => vrmInputRef.current?.click()}
              >
                <Upload className="w-4 h-4" /> {customAvatar ? 'Replace Avatar' : 'Upload VRM'}
              </button>
              <input 
                type="file" 
                ref={vrmInputRef} 
                style={{ display: 'none' }}
                accept=".vrm"
                onChange={handleVrmUpload}
              />
          </div>
        </div>

        {customAvatar && (
          <div className="mt-2 flex flex-col gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
             <div className="flex items-center justify-between">
               <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
                    <Box className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-blue-100">Currently Active: {customAvatar.name}</p>
                    <p className="text-[10px] text-blue-200/50">Overrides the default system model</p>
                  </div>
               </div>
               
               <button 
                 onClick={() => handleDelete(customAvatar.id)}
                 className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                 title="Delete Custom Avatar"
               >
                 <Trash2 className="w-4 h-4" />
               </button>
             </div>
             
             {/* Flip Toggle */}
             <div className="flex items-center justify-between pt-3 border-t border-blue-500/20">
               <div>
                 <label className="block text-sm font-medium text-blue-100">Flip Custom Model (180°)</label>
                 <p className="text-xs text-blue-200/50 mt-1">Enable this if your uploaded model faces backwards.</p>
               </div>
               <button
                 onClick={() => {
                   const next = !flipCustomModel;
                   setFlipCustomModel(next);
                   localStorage.setItem('soltini_flip_vrm', String(next));
                   emitCrossWindow('soltini-vrm-changed');
                 }}
                 className={`relative w-10 h-5 rounded-full transition-colors ${flipCustomModel ? 'bg-blue-500' : 'bg-black/40 border border-blue-500/20'}`}
               >
                 <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${flipCustomModel ? 'translate-x-5' : 'translate-x-0'}`} />
               </button>
             </div>
          </div>
        )}
      </div>

      {/* --- ANIMATIONS UPLOAD SECTION --- */}
      <div className="bg-black/20 border border-white/5 rounded-2xl p-6 flex flex-col gap-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-pink-500"></div>

        <div>
          <h4 className="font-semibold text-lg text-pink-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-pink-400" /> AI Animations
          </h4>
          <p className="text-xs text-white/50 mt-1 max-w-md">
            Upload up to 4 custom <b>.fbx</b> or <b>.bvh</b> animations. Assign a simple slug name (e.g. `backflip`), and the AI will automatically learn how to use it!
          </p>
        </div>

        {/* Add Animation Form */}
        <div className="flex gap-4 items-end flex-wrap bg-white/5 p-4 rounded-xl border border-white/5">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-[10px] font-bold text-pink-300/80 uppercase tracking-wider">Animation Slug</label>
            <input 
              type="text" 
              placeholder="e.g. salsa-dance, backflip"
              className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-pink-500 transition-colors"
              value={animSlug}
              onChange={e => setAnimSlug(e.target.value.toLowerCase())}
              disabled={animations.length >= 4}
            />
          </div>
          
          <div className="flex flex-col gap-1 shrink-0">
            <button 
              className="bg-pink-600/80 hover:bg-pink-500 text-white px-5 py-2 rounded-lg font-medium transition-colors text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-pink-500/20"
              onClick={() => animInputRef.current?.click()}
              disabled={!animSlug.trim() || animations.length >= 4}
            >
              <Upload className="w-4 h-4" /> Upload FBX/BVH
            </button>
            <input 
              type="file" 
              ref={animInputRef} 
              style={{ display: 'none' }}
              accept=".fbx,.bvh"
              onChange={handleAnimUpload}
            />
          </div>
        </div>

        {!animSlug.trim() && animations.length < 4 && (
          <p className="text-[10px] text-yellow-400/80 flex items-center gap-1 -mt-3">
            <AlertCircle className="w-3 h-3" /> Type a simple slug name first (e.g. `dance2`)
          </p>
        )}

        {/* List of Animations */}
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex justify-between items-center mb-1">
             <h5 className="text-sm font-semibold text-white/80">Stored Animations</h5>
             <span className="text-xs font-mono bg-black/40 px-2 py-0.5 rounded text-white/50">{animations.length} / 4 Slots</span>
          </div>
          
          {animations.length === 0 ? (
            <div className="text-center py-6 text-white/30 italic bg-black/20 rounded-xl border border-white/5 text-sm">
              No custom animations learned yet.
            </div>
          ) : (
            animations.map(a => (
              <div key={a.id} className="flex items-center justify-between bg-pink-500/5 border border-pink-500/10 hover:bg-pink-500/10 transition-colors rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-pink-500/20 text-pink-400">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-pink-100">{a.id}</p>
                    <p className="text-[10px] text-white/40">{a.name}</p>
                  </div>
                </div>
                <button 
                  onClick={() => handleDelete(a.id)}
                  className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                  title="Delete Animation"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
