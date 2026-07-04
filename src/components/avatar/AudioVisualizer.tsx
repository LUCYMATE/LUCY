import { useEffect, useRef } from 'react';
import { useAvatarState } from '../../lib/store/avatarState';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  type: 'input' | 'output'; // input is mic (pink/purple), output is Syra speaking (blue/pink)
}

export function AudioVisualizer({ analyser, isActive, type }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const amplitudeRef = useRef(0.02); // Initial resting amplitude

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let phase = 0;
    
    // Resize handler
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Multi-wave definitions
    const waves = [
      { speed: 0.15, phaseShift: 0, opacity: 0.7, width: 2.5, frequency: 1 },
      { speed: -0.10, phaseShift: Math.PI / 3, opacity: 0.45, width: 1.5, frequency: 1.5 },
      { speed: 0.08, phaseShift: Math.PI / 1.5, opacity: 0.25, width: 1.0, frequency: 0.8 },
      { speed: -0.12, phaseShift: Math.PI, opacity: 0.15, width: 0.8, frequency: 2 }
    ];

    const draw = () => {
      if (!canvas || !ctx) return;

      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Get target amplitude from analyser
      let targetAmplitude = 0.02; // resting height
      if (isActive && analyser) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128; // normalize
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        // Scale and cap the target amplitude
        targetAmplitude = Math.max(0.02, Math.min(1.0, rms * 4.0));
      }

      if (type === 'input') {
        const isHearingNow = targetAmplitude > 0.05;
        const currentState = useAvatarState.getState().isHearingSound;
        if (isHearingNow !== currentState) {
           useAvatarState.getState().setHearingSound(isHearingNow);
        }
      }

      // Smooth amplitude transitions (lerp)
      amplitudeRef.current += (targetAmplitude - amplitudeRef.current) * 0.15;
      const currentAmp = amplitudeRef.current;

      // Draw each wave path
      waves.forEach((wave) => {
        ctx.beginPath();
        ctx.lineWidth = wave.width;

        // Set wave stroke style (gradient or color)
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        if (type === 'input') {
          // Mic Input: Pink-to-Purple
          gradient.addColorStop(0, `rgba(219, 39, 119, ${wave.opacity})`); // pink-600
          gradient.addColorStop(0.5, `rgba(168, 85, 247, ${wave.opacity})`); // purple-500
          gradient.addColorStop(1, `rgba(139, 92, 246, ${wave.opacity})`); // violet-500
        } else {
          // AI Output: Blue-to-Pink
          gradient.addColorStop(0, `rgba(59, 130, 246, ${wave.opacity})`); // blue-500
          gradient.addColorStop(0.5, `rgba(139, 92, 246, ${wave.opacity})`); // violet-500
          gradient.addColorStop(1, `rgba(219, 39, 119, ${wave.opacity})`); // pink-600
        }
        ctx.strokeStyle = gradient;

        // Draw the wave shape
        for (let x = 0; x < width; x += 2) {
          // Normalized x coordinate from 0 to 1
          const normX = x / width;
          
          // Sine wave calculation
          const angle = normX * Math.PI * 2 * wave.frequency + phase + wave.phaseShift;
          
          // Apply a sine envelope to pinch the ends of the wave at the screen edges
          const envelope = Math.sin(normX * Math.PI);
          
          // Calculate final Y position
          const y = centerY + Math.sin(angle) * currentAmp * (height * 0.4) * envelope;

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      });

      // Update global phase
      phase += 0.05;

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser, isActive, type]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-full block pointer-events-none" 
      style={{ opacity: isActive ? 1.0 : 0.4, transition: 'opacity 0.3s ease' }}
    />
  );
}
