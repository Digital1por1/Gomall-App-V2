
import React, { useState } from 'react';
import { GeneratedImage } from '../types';
import { recordUsage } from './usageTracker';

const ImageGen: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateImage = async () => {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          genType: 'simple_image'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');

      const foundImageUrl = data.imageUrl || '';

      if (foundImageUrl) {
        recordUsage('imagen_simple', data.usage);
        const newImg: GeneratedImage = {
          id: Date.now().toString(),
          url: foundImageUrl,
          prompt,
          timestamp: Date.now(),
        };
        setImages((prev) => [newImg, ...prev]);
        setPrompt('');
      } else {
        alert('Could not find image in model response.');
      }
    } catch (error) {
      console.error('Image generation error:', error);
      alert('Failed to generate image. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="h-full flex flex-col p-4 md:p-8 overflow-y-auto space-y-8 bg-slate-900">
      <div className="max-w-4xl mx-auto w-full space-y-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
          AI Image Generator
        </h2>
        <p className="text-slate-400">Describe whatever you want to see, and Gemini will bring it to life.</p>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A futuristic cybernetic city with neon waterfalls..."
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-purple-500 text-white placeholder-slate-500 resize-none"
          />
          <button
            onClick={generateImage}
            disabled={isGenerating || !prompt.trim()}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-4 rounded-xl font-bold transition-all h-fit self-end flex items-center gap-2"
          >
            {isGenerating ? (
              <>
                <i className="fa-solid fa-circle-notch animate-spin"></i>
                Generating...
              </>
            ) : (
              <>
                <i className="fa-solid fa-wand-magic-sparkles"></i>
                Create
              </>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto w-full">
        {images.map((img) => (
          <div key={img.id} className="group relative bg-slate-800 rounded-2xl overflow-hidden border border-slate-700 shadow-xl transition-transform hover:scale-[1.02]">
            <img src={img.url} alt={img.prompt} className="w-full aspect-square object-cover" />
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity p-4 flex flex-col justify-end">
              <p className="text-sm text-white line-clamp-3 mb-2">"{img.prompt}"</p>
              <button 
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = img.url;
                  link.download = `gemini-image-${img.id}.png`;
                  link.click();
                }}
                className="bg-white/20 hover:bg-white/40 text-white text-xs py-2 rounded-lg backdrop-blur-md transition-colors flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-download"></i>
                Download
              </button>
            </div>
          </div>
        ))}
        {images.length === 0 && !isGenerating && (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-800 rounded-3xl">
            <i className="fa-regular fa-image text-5xl text-slate-700 mb-4 block"></i>
            <p className="text-slate-500">Your generated images will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageGen;