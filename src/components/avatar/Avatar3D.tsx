import { useState, useEffect, Suspense, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { VrmModel, clearVrmCache, clearAssetResolutionCache } from './VrmModel';
import { clearFbxCache } from './animations/useFbxAnimation';
import { useAvatarState } from '../../lib/store/avatarState';
import { useEngineStore } from '../../lib/store/engineStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Lock, Unlock, Mic, MicOff, Settings, MessageCircle, Maximize2, Power, Wand2, CalendarClock, Trash2, Clock, Terminal, Layers, ChevronLeft, LogOut } from 'lucide-react';

// Highly optimized FPS limiter using rAF instead of setInterval
function FpsLimiter() {
  const { invalidate } = useThree();
  const [limit, setLimit] = useState(() => localStorage.getItem('soltini_low_fps') === 'true' ? 30 : 60);
  const isActive = useRef(false);

  useEffect(() => {
    const handleFpsChange = () => setLimit(localStorage.getItem('soltini_low_fps') === 'true' ? 30 : 60);
    window.addEventListener('soltini-settings-changed', handleFpsChange);
    return () => window.removeEventListener('soltini-settings-changed', handleFpsChange);
  }, []);

  useEffect(() => {
    const unsub = useAvatarState.subscribe((s) => {
      isActive.current = s.isSpeaking || s.isThinking || s.isWalking || s.isDragging;
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let lastTime = 0;
    let frameId = 0;

    const loop = (time: number) => {
      // 60/30 FPS when active, 15 FPS when idle to keep breathing/blinking alive with 4x less CPU overhead
      const currentLimit = isActive.current ? limit : 15;
      const interval = 1000 / currentLimit;

      if (time - lastTime >= interval) {
        lastTime = time - ((time - lastTime) % interval);
        invalidate();
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [limit, invalidate]);
  return null;
}

// Forces Chromium to discard the WebGL context and GPU memory immediately when Canvas unmounts
function WebGLContextLoser() {
  const { gl } = useThree();
  useEffect(() => {
    return () => {
      setTimeout(() => {
        try {
          const ext = gl.extensions.get('WEBGL_lose_context') as any;
          if (ext) ext.loseContext();
          gl.dispose();
        } catch (e) {
          console.error("Failed to aggressively release WebGL Context", e);
        }
      }, 0);
    };
  }, [gl]);
  return null;
}

function Stool({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <group position={[0, 0, -0.1]} scale={1}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.04, 32]} />
        <meshStandardMaterial color="#1f2937" roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.225, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.45, 16]} />
        <meshStandardMaterial color="#9ca3af" roughness={0.3} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.02, 32]} />
        <meshStandardMaterial color="#1f2937" roughness={0.7} metalness={0.2} />
      </mesh>
    </group>
  );
}

// Optimized WebGL particles without heavy <Html> DOM overhead
function FlyingKisses({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<any[]>([]);
  const hasSpawnedRef = useRef<boolean>(false);
  const lastSpawnTimeRef = useRef<number>(0);

  // Pre-create geometry and material to avoid GC hitches
  const particleGeo = useMemo(() => new THREE.PlaneGeometry(0.2, 0.2), []);
  const particleMat = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, '#fbcfe8');
      grad.addColorStop(1, '#ec4899');
      ctx.fillStyle = grad;
      ctx.beginPath();
      // Simple heart path scaled to 64x64
      ctx.moveTo(32, 57);
      ctx.bezierCurveTo(32, 57, 6, 39, 6, 21);
      ctx.bezierCurveTo(6, 11, 15, 4, 23, 4);
      ctx.bezierCurveTo(28, 4, 31, 7, 32, 10);
      ctx.bezierCurveTo(33, 7, 36, 4, 41, 4);
      ctx.bezierCurveTo(49, 4, 58, 11, 58, 21);
      ctx.bezierCurveTo(58, 39, 32, 57, 32, 57);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  }, []);

  useFrame((_state, delta) => {
    if (active) {
      const lastOverride = useAvatarState.getState().lastPoseOverrideTime;
      const localTime = (Date.now() - lastOverride) / 1000.0;

      if (lastOverride !== lastSpawnTimeRef.current) {
        lastSpawnTimeRef.current = lastOverride;
        hasSpawnedRef.current = false;
        setParticles([]);
      }

      if (localTime >= 1.2 && !hasSpawnedRef.current) {
        setParticles([
          { id: Math.random(), x: -0.15, y: 0, vx: -0.05, vy: 0.2, life: 1.0, scale: 0.8 },
          { id: Math.random(), x: 0.15, y: -0.1, vx: 0.05, vy: 0.15, life: 1.0, scale: 1.1 },
        ]);
        hasSpawnedRef.current = true;
      }
    } else {
      hasSpawnedRef.current = false;
    }

    if (particles.length > 0) {
      setParticles(prev => prev.map(p => {
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.life -= delta * 0.7;
        return p;
      }).filter(p => p.life > 0));
    }
  });

  if (particles.length === 0) return null;

  return (
    <group position={[0, 1.45, 0.4]}>
      {particles.map(p => {
        const age = 1.0 - p.life;
        const scale = Math.min(1.0, age * 5.0) * p.scale + (age * 0.5);
        return (
          <mesh 
            key={p.id} 
            geometry={particleGeo} 
            material={particleMat} 
            position={[p.x, p.y, 0]} 
            scale={[scale, scale, scale]} 
          />
        );
      })}
    </group>
  );
}

const ZOOM = 250; 
const _lerpTarget = new THREE.Vector3();

// We moved DragHitboxes outside the Canvas to fix the Tauri transparent click-through system.


function SceneManager() {
  const {
    isSpeaking, isThinking, isListening, basePose, isWalking, emotion,
    worldPosition, targetPosition, isDragging, avatarScale, setTargetPosition
  } = useAvatarState(useShallow(s => ({
    isSpeaking: s.isSpeaking,
    isThinking: s.isThinking,
    isListening: s.isListening,
    basePose: s.basePose,
    isWalking: s.isWalking,
    emotion: s.emotion,
    worldPosition: s.worldPosition,
    targetPosition: s.targetPosition,
    isDragging: s.isDragging,
    avatarScale: s.avatarScale,
    setTargetPosition: s.setTargetPosition
  })));

  const groupRef = useRef<THREE.Group>(null);
  const scaleGroupRef = useRef<THREE.Group>(null);
  const [internalMoveDir, setInternalMoveDir] = useState(Math.PI);

  useEffect(() => {
    const onSettingsChanged = () => {
      const val = localStorage.getItem('soltini_avatar_size');
      if (val) {
        const n = parseFloat(val);
        if (!isNaN(n)) useAvatarState.getState().setAvatarScale(n / 100);
      }
    };
    window.addEventListener('soltini-settings-changed', onSettingsChanged);
    return () => window.removeEventListener('soltini-settings-changed', onSettingsChanged);
  }, []);

  const initialModelUrl = typeof window !== 'undefined' && localStorage.getItem('soltini_has_custom_avatar') === 'false' ? '/soltini.vrm' : null;
  const [modelUrl, setModelUrl] = useState<string | null>(initialModelUrl);
  const [vrmReloadKey, setVrmReloadKey] = useState(0);
  const blobUrlRef = useRef<string | null>(null);
  const modelUrlRef = useRef<string | null>(initialModelUrl);

  const refreshModelUrl = (forceBustCache = false) => {
    import('../../lib/system/assetDB').then(({ getAssetDataUrl, getAsset }) => {
      getAsset('custom-avatar').then(asset => {
        if (!asset || asset.type !== 'vrm') {
          localStorage.setItem('soltini_has_custom_avatar', 'false');
          if (useAvatarState.getState().flipCustomModel) {
            useAvatarState.getState().setFlipCustomModel(false);
            localStorage.setItem('soltini_flip_vrm', 'false');
          }
          if (modelUrlRef.current !== '/soltini.vrm' || forceBustCache) {
            if (blobUrlRef.current && blobUrlRef.current.startsWith('blob:')) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
            if (modelUrlRef.current !== '/soltini.vrm' || forceBustCache) clearVrmCache?.();
            modelUrlRef.current = '/soltini.vrm';
            setModelUrl('/soltini.vrm');
            setVrmReloadKey(k => k + 1);
          }
          return;
        }
        
        localStorage.setItem('soltini_has_custom_avatar', 'true');
        getAssetDataUrl('custom-avatar').then(url => {
          if (url) {
            if (modelUrlRef.current !== url || forceBustCache) {
              if (blobUrlRef.current && blobUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(blobUrlRef.current);
              blobUrlRef.current = url;
              clearVrmCache?.();
              modelUrlRef.current = url;
              setModelUrl(url);
              setVrmReloadKey(k => k + 1);
            }
          }
        });
      });
    });
  };

  useEffect(() => {
    refreshModelUrl(false);
    
    const onSettingsChanged = () => {
      clearFbxCache();
      clearAssetResolutionCache();
    };
    
    const onVrmChanged = () => {
      clearFbxCache();
      clearAssetResolutionCache();
      refreshModelUrl(true);
    };
    
    window.addEventListener('soltini-settings-changed', onSettingsChanged);
    window.addEventListener('soltini-vrm-changed', onVrmChanged);
    return () => {
      window.removeEventListener('soltini-settings-changed', onSettingsChanged);
      window.removeEventListener('soltini-vrm-changed', onVrmChanged);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_state, delta) => {
    if (!groupRef.current) return;

    let distance = 0;
    if (targetPosition) {
      const diffX = targetPosition.x - groupRef.current.position.x;
      const diffY = targetPosition.y - groupRef.current.position.y;
      distance = Math.sqrt(diffX * diffX + diffY * diffY);

      let positionChanged = false;
      if (isWalking && distance > 0.01 && !isDragging) {
        const speed = basePose.startsWith('peek') ? 0.8 : 1.5;
        const step = speed * delta;
        if (distance <= step) {
          groupRef.current.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
        } else {
          groupRef.current.position.x += (diffX / distance) * step;
          groupRef.current.position.y += (diffY / distance) * step;
        }
        positionChanged = true;
      } else {
        _lerpTarget.set(targetPosition.x, targetPosition.y, targetPosition.z);
        // Only keep lerping (and flag a change) while the avatar is still noticeably moving.
        // Once it has effectively arrived, we stop both the math and the per-frame store write,
        // which previously fired ~15-60x/sec even on a perfectly still avatar.
        if (distance > 0.0005 || isDragging) {
          groupRef.current.position.lerp(_lerpTarget, isDragging ? 0.2 : delta * 5.0);
          positionChanged = true;
        }
      }

      // Only push the new position into the store when the avatar actually moved. This avoids
      // a per-frame Zustand notification (and any downstream IPC/subscriber work) while idle.
      if (positionChanged) {
        useAvatarState.getState().setWorldPosition({
          x: groupRef.current.position.x,
          y: groupRef.current.position.y,
          z: groupRef.current.position.z
        });
      }

      const flip = useAvatarState.getState().flipCustomModel;
      let targetRotY = flip ? 0 : Math.PI;

      if (distance > 0.05 && isWalking && !isDragging) {
        targetRotY = -Math.atan2(diffX, diffY) + (flip ? Math.PI : 0);
      } else if (basePose.startsWith('peek')) {
        targetRotY = flip ? 0 : Math.PI;
      }

      if (distance < 0.05 && isWalking && !isDragging) {
        useAvatarState.getState().setIsWalking(false);
      }

      if (targetRotY !== internalMoveDir) {
        setInternalMoveDir(targetRotY);
      }
    }

    // Smooth Scale Logic
    if (scaleGroupRef.current) {
      const currentScale = scaleGroupRef.current.scale.x;
      const isArrived = distance < 0.05;
      
      // If she is growing, wait until she reaches the destination before scaling up.
      // If she is shrinking, do it immediately so she doesn't block the screen while walking.
      const targetS = (avatarScale > currentScale && !isArrived && isWalking) ? currentScale : avatarScale;
      
      if (Math.abs(currentScale - targetS) > 0.001) {
        const newScale = THREE.MathUtils.lerp(currentScale, targetS, delta * 6.0);
        scaleGroupRef.current.scale.setScalar(newScale);
      }
    }
  });

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.pet-context-menu')) return;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', handleClick);
    return () => window.removeEventListener('pointerdown', handleClick);
  }, []);

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
    }
    if (scaleGroupRef.current) {
      scaleGroupRef.current.scale.setScalar(avatarScale); // Initial set
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const edgeX = (ww / 2) / ZOOM;
    const currentPos = useAvatarState.getState().worldPosition;

    if (basePose === 'peek-left') {
      setTargetPosition({ x: -(edgeX + 0.1), y: currentPos.y, z: currentPos.z });
      useAvatarState.getState().setIsWalking(true);
    } else if (basePose === 'peek-right') {
      setTargetPosition({ x: (edgeX + 0.1), y: currentPos.y, z: currentPos.z });
      useAvatarState.getState().setIsWalking(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePose]);

  const isCurrentlySitting = basePose === 'sit' && !isWalking;
  const y_head  = isCurrentlySitting ? 1.03 : 1.45;
  const y_waist = isCurrentlySitting ? 0.43 : 0.85;
  const y_feet  = 0.15;

  return (
    <group ref={groupRef}>
      <group ref={scaleGroupRef}>
        <group position={[0, -1.2, 0]}>
          <Stool visible={isCurrentlySitting} />
          <FlyingKisses active={basePose === 'flying-kiss'} />

          {modelUrl && (
            <VrmModel
              url={modelUrl}
              reloadKey={vrmReloadKey}
              isSpeaking={isSpeaking}
              isThinking={isThinking}
              isListening={isListening}
              basePose={basePose}
              isWalking={isWalking}
              emotion={emotion}
              moveDirection={internalMoveDir}
              isSitting={isCurrentlySitting}
            />
          )}
        </group>
      </group>

      <Html center zIndexRange={[100, 0]}>
        <div className="pointer-events-none relative" style={{ width: 0, height: 0 }}>
          <DragHitboxes avatarScale={avatarScale} />
        </div>
      </Html>
    </group>
  );
}

function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const { isAvatarLocked, setIsAvatarLocked, avatarScale, setAvatarScale, isMicOn } = useAvatarState(useShallow(s => ({
    isAvatarLocked: s.isAvatarLocked,
    setIsAvatarLocked: s.setIsAvatarLocked,
    avatarScale: s.avatarScale,
    setAvatarScale: s.setAvatarScale,
    isMicOn: s.isMicOn
  })));
  const [showSizeSlider, setShowSizeSlider] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);

  const setSize = (pct: number) => {
    localStorage.setItem('soltini_avatar_size', pct.toString());
    setAvatarScale(pct / 100);
    window.dispatchEvent(new CustomEvent('soltini-settings-changed'));
  };

  const handleLockAvatar = () => {
    const val = !isAvatarLocked;
    setIsAvatarLocked(val);
    const s = useAvatarState.getState();
    if (val) {
      s.setLockedPosition({ ...s.worldPosition });
    } else {
      s.setLockedPosition(null);
    }
    localStorage.setItem('soltini_avatar_locked', String(val));
    onClose();
  };

  const handleMicToggle = async () => {
    const { emit } = await import('@tauri-apps/api/event');
    emit('soltini-toggle-mic');
  };

  const openChat = () => {
    window.dispatchEvent(new CustomEvent('soltini-open-chat'));
    onClose();
  };

  const openSettings = () => {
    window.dispatchEvent(new CustomEvent('soltini-open-settings'));
    onClose();
  };

  const openLogs = () => {
    window.dispatchEvent(new CustomEvent('soltini-open-logs'));
    onClose();
  };

  const [showTasksPopup, setShowTasksPopup] = useState(false);
  const [tasks, setTasks] = useState<{id: string, targetTimeMs: number, instruction: string}[]>([]);

  useEffect(() => {
    if (!showTasksPopup) return;
    const fetchTasks = async () => {
      const { getScheduledTasks } = await import('../../lib/gemini/gemini-live');
      setTasks(getScheduledTasks());
    };
    fetchTasks();
    const handleUpdate = () => fetchTasks();
    window.addEventListener('soltini-tasks-changed', handleUpdate);
    return () => window.removeEventListener('soltini-tasks-changed', handleUpdate);
  }, [showTasksPopup]);

  const openTasks = () => {
    window.dispatchEvent(new CustomEvent('soltini-open-tasks', { detail: { x, y } }));
    onClose();
  };

  const handleCancelTask = async (id: string) => {
    const { cancelScheduledTaskById } = await import('../../lib/gemini/gemini-live');
    cancelScheduledTaskById(id);
  };

  const sleepApp = async () => {
    try {
      useAvatarState.getState().setIsSleepMode(true);
      window.dispatchEvent(new CustomEvent('soltini-sleep'));
    } catch (e) {
      console.warn("Error entering sleep mode:", e);
    }
  };

  // Radial math
  const radius = 85;
  
  const mainItems = [
    { id: 'mic', icon: isMicOn ? <Mic className="w-5 h-5 text-pink-400" /> : <MicOff className="w-5 h-5 text-white/50" />, action: handleMicToggle, label: 'Mic' },
    { id: 'chat', icon: <MessageCircle className="w-5 h-5 text-blue-400" />, action: openChat, label: 'Chat' },
    { id: 'apps', icon: <Layers className="w-5 h-5 text-blue-400" />, action: () => { setShowSubMenu(true); setShowSizeSlider(false); setShowTasksPopup(false); }, label: 'More' },
    { id: 'settings', icon: <Settings className="w-5 h-5 text-gray-300" />, action: openSettings, label: 'Settings' },
    { id: 'size', icon: <Maximize2 className="w-5 h-5 text-green-400" />, action: () => { setShowSizeSlider(!showSizeSlider); setShowTasksPopup(false); setShowSubMenu(false); }, label: 'Size' },
    { id: 'lock', icon: isAvatarLocked ? <Lock className="w-5 h-5 text-yellow-400" /> : <Unlock className="w-5 h-5 text-white/50" />, action: handleLockAvatar, label: 'Lock' },
    { id: 'sleep', icon: <Power className="w-5 h-5 text-red-500" />, action: sleepApp, label: 'Sleep' },
  ];

  const subItems = [
    { id: 'back', icon: <ChevronLeft className="w-5 h-5 text-white/80" />, action: () => setShowSubMenu(false), label: 'Back' },
    { id: 'logs', icon: <Terminal className="w-5 h-5 text-purple-400" />, action: openLogs, label: 'Logs' },
    { id: 'tasks', icon: <CalendarClock className="w-5 h-5 text-purple-400" />, action: openTasks, label: 'Tasks' },
    { id: 'quit', icon: <LogOut className="w-5 h-5 text-red-500" />, action: () => {
      import('@tauri-apps/api/core').then(({ invoke }) => invoke('exit_app')).catch(() => window.close());
    }, label: 'Quit' },
  ];

  const items = showSubMenu ? subItems : mainItems;

  return (
    <div
      className="avatar-context-menu fixed pointer-events-auto z-[9999] animate-in fade-in zoom-in-95 duration-200"
      style={{ left: x, top: y, width: 0, height: 0 }}
    >
      {/* Pink Round Ribbon Path (Track) */}
      <svg 
        className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none drop-shadow-[0_0_10px_rgba(236,72,153,0.4)]"
        width={radius * 2 + 60} 
        height={radius * 2 + 60}
      >
        <circle 
          cx={radius + 30} 
          cy={radius + 30} 
          r={radius} 
          fill="none" 
          stroke="rgba(236,72,153,0.25)" 
          strokeWidth="44"
          className="pointer-events-auto"
        />
        <circle 
          cx={radius + 30} 
          cy={radius + 30} 
          r={radius} 
          fill="none" 
          stroke="rgba(236,72,153,0.5)" 
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      </svg>

      <button 
        onClick={onClose}
        title="Close Menu"
        className="absolute -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full glass border border-pink-300 flex items-center justify-center hover:bg-pink-500/40 transition-colors shadow-lg z-10 pointer-events-auto"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      {items.map((item, i) => {
        const angle = (i * (360 / items.length) - 90) * (Math.PI / 180);
        const bx = Math.cos(angle) * radius;
        const by = Math.sin(angle) * radius;
        return (
          <button
            key={item.id}
            onClick={item.action}
            title={item.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-blue-600/30 backdrop-blur-md border border-blue-400/30 flex items-center justify-center hover:bg-blue-500/60 hover:border-blue-400/80 hover:shadow-[0_0_15px_rgba(59,130,246,0.6)] transition-all duration-300 hover:scale-110 shadow-md pointer-events-auto"
            style={{ left: bx, top: by }}
          >
            {item.icon}
          </button>
        );
      })}

      {showSizeSlider && (
        <div className="absolute top-24 -translate-x-1/2 w-48 glass rounded-xl p-3 border border-white/10 flex flex-col gap-2 shadow-xl animate-in slide-in-from-top-2 fade-in pointer-events-auto">
          <span className="text-[10px] text-white/50 uppercase text-center font-bold">Avatar Size</span>
          <input 
            type="range" min="50" max="200" step="10" 
            value={Math.round(avatarScale * 100)} 
            onChange={(e) => setSize(parseInt(e.target.value))}
            className="w-full h-1.5 bg-white/20 rounded-full appearance-none accent-pink-500 cursor-pointer pointer-events-auto"
          />
          <div className="flex gap-1 mt-1">
            <button onClick={() => setSize(70)} className="flex-1 text-[10px] bg-white/5 hover:bg-white/15 rounded py-1 transition-colors">S</button>
            <button onClick={() => setSize(100)} className="flex-1 text-[10px] bg-white/5 hover:bg-white/15 rounded py-1 transition-colors">M</button>
            <button onClick={() => setSize(150)} className="flex-1 text-[10px] bg-white/5 hover:bg-white/15 rounded py-1 transition-colors">L</button>
          </div>
        </div>
      )}

      {showTasksPopup && (
        <div className="absolute top-24 -translate-x-1/2 w-64 glass rounded-xl p-3 border border-white/10 shadow-xl animate-in slide-in-from-top-2 fade-in pointer-events-auto flex flex-col gap-2">
          <div className="flex items-center gap-2 pb-2 border-b border-white/10">
            <CalendarClock className="w-4 h-4 text-pink-400" />
            <span className="text-xs text-white/90 font-bold uppercase">Scheduled Tasks</span>
          </div>
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
            {tasks.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-2">No tasks right now.</p>
            ) : (
              tasks.map(t => (
                <div key={t.id} className="bg-white/5 rounded-lg p-2 flex flex-col gap-1 relative group">
                  <p className="text-[10px] text-white/80 line-clamp-2 pr-5">{t.instruction}</p>
                  <p className="text-[9px] text-pink-300 font-mono flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(t.targetTimeMs).toLocaleTimeString()}</p>
                  <button onClick={() => handleCancelTask(t.id)} className="absolute right-1 top-1 p-1 hover:bg-red-500/20 rounded text-red-400 transition-colors opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DragHitboxes({ avatarScale }: { avatarScale: number }) {
  const { basePose, isWalking } = useAvatarState(useShallow(s => ({ basePose: s.basePose, isWalking: s.isWalking })));
  const cursorTargetRef = useRef<{ x: number, y: number, z: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = useAvatarState.getState();
    cursorTargetRef.current = { ...s.worldPosition };
    s.setIsDragging(true);
    // Snap out of any stuck animation when grabbed
    s.setBasePose('stand');
    s.setIsWalking(false);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const s = useAvatarState.getState();
    if (s.isDragging && cursorTargetRef.current) {
      const movementX = e.movementX / ZOOM;
      const movementY = -e.movementY / ZOOM;

      const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const wh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const edgeX = (ww / 2) / ZOOM;
      const edgeY = (wh / 2) / ZOOM;
      
      const minX = -edgeX;
      const maxX = edgeX;
      const maxY = edgeY + 0.2 * avatarScale;
      const minY = -edgeY + 0.2 * avatarScale;

      cursorTargetRef.current.x = Math.max(minX, Math.min(maxX, cursorTargetRef.current.x + movementX));
      cursorTargetRef.current.y = Math.max(minY, Math.min(maxY, cursorTargetRef.current.y + movementY));

      s.setTargetPosition({ ...cursorTargetRef.current });
      
      const diffX = cursorTargetRef.current.x - s.worldPosition.x;
      const diffY = cursorTargetRef.current.y - s.worldPosition.y;
      s.setDragOffset({ x: diffX, y: diffY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = useAvatarState.getState();
    s.setIsDragging(false);
    s.setDragOffset({ x: 0, y: 0 });

    const finalX = cursorTargetRef.current?.x ?? s.worldPosition.x;
    const finalY = cursorTargetRef.current?.y ?? s.worldPosition.y;

    const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const wh = typeof window !== 'undefined' ? window.innerHeight : 800;

    const screenX = finalX * 250 + ww / 2;
    // Check if the feet are near the top edge
    const feetY = finalY - 1.2 * avatarScale;
    const screenFeetY = -feetY * 250 + wh / 2;

    let snapped = false;

    if (s.desktopRectangles) {
      const threshold = 50; // snap threshold in pixels
      for (const rect of s.desktopRectangles) {
        if (screenX >= rect.x - 50 && screenX <= rect.x + rect.width + 50) {
          
          let isMatch = false;
          if (rect.is_taskbar) {
            // Taskbar is at the bottom, so if they drag it anywhere near or below the top edge, snap it!
            isMatch = screenFeetY > rect.y - threshold;
          } else {
            // Windows: must be near the title bar specifically
            isMatch = Math.abs(screenFeetY - rect.y) < threshold;
          }

          if (isMatch) {
            snapped = true;
            s.setAnchor({ type: rect.is_taskbar ? 'taskbar' : 'window', rect });
            const edgeWorldY = -(rect.y - wh / 2) / 250;
            s.setTargetPosition({ 
              x: finalX, 
              y: edgeWorldY + (rect.is_taskbar ? 1.2 : 1.15) * avatarScale,
              z: 0 
            });
            s.setIsAvatarLocked(true);
            s.setBasePose('sit');
            break;
          }
        }
      }
    }

    if (!snapped) {
      s.setAnchor(null);
      s.setTargetPosition({ x: finalX, y: finalY, z: 0 });
      if (s.isAvatarLocked) {
        s.setLockedPosition({ x: finalX, y: finalY, z: 0 });
      }
    }

    e.currentTarget.releasePointerCapture(e.pointerId);
    
    if (s.basePose.startsWith('peek')) {
      s.setBasePose('stand');
      s.setIsWalking(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.avatar-context-menu')) return;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', handleClick);
    return () => window.removeEventListener('pointerdown', handleClick);
  }, []);

  const isCurrentlySitting = basePose === 'sit' && !isWalking;
  const y_head  = isCurrentlySitting ? 1.03 : 1.45;
  const y_waist = isCurrentlySitting ? 0.43 : 0.85;
  const y_feet  = 0.15;

  const getHandleStyle = (yLocal: number, widthBase: number, heightBase: number) => {
    const w = widthBase * avatarScale;
    const h = heightBase * avatarScale;
    const yPixel = (-1.2 * avatarScale + yLocal * avatarScale) * ZOOM;
    return {
      position: 'absolute' as const,
      width: w,
      height: h,
      left: `calc(50% - ${w / 2}px)`,
      top: `${-yPixel - h / 2}px`,
      borderRadius: '50%',
    };
  };

  return (
    <>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        className="cursor-grab active:cursor-grabbing pointer-events-auto"
        style={getHandleStyle(y_head, 120, 120)}
      />
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        className="cursor-grab active:cursor-grabbing pointer-events-auto"
        style={getHandleStyle(y_waist, 160, 200)}
      />
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        className="cursor-grab active:cursor-grabbing pointer-events-auto"
        style={getHandleStyle(y_feet, 180, 100)}
      />
      {contextMenu && createPortal(
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} />,
        document.body
      )}
    </>
  );
}

function AvatarLoader() {
  return (
    <Html center>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        userSelect: 'none',
        pointerEvents: 'none',
      }}>
        {/* Pulsing glow orb */}
        <div style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(167,139,250,0.9) 0%, rgba(236,72,153,0.4) 60%, transparent 100%)',
          boxShadow: '0 0 20px rgba(167,139,250,0.6), 0 0 40px rgba(236,72,153,0.2)',
          animation: 'avatar-pulse 1.4s ease-in-out infinite',
        }} />
        <style>{`
          @keyframes avatar-pulse {
            0%, 100% { transform: scale(0.85); opacity: 0.6; }
            50% { transform: scale(1.15); opacity: 1; }
          }
        `}</style>
      </div>
    </Html>
  );
}

export function Avatar3D() {
  return (
    <div className="w-full h-full pointer-events-none relative">
      <Canvas
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ powerPreference: "low-power", antialias: true, alpha: true }}
        style={{ pointerEvents: 'none' }}
      >
        <WebGLContextLoser />
        <FpsLimiter />
        <OrthographicCamera makeDefault position={[0, 0, 5]} zoom={ZOOM} />

        <Suspense fallback={<AvatarLoader />}>
          <ambientLight intensity={0.8} color="#ffffff" />
          <directionalLight position={[0, 2, 2]} intensity={1} color="#ffffff" />
          <SceneManager />
        </Suspense>
      </Canvas>
    </div>
  );
}
