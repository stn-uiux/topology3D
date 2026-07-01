import React, { useMemo } from 'react';

export const StarsBackground: React.FC = () => {
  const stars = useMemo(() => {
    // 200개의 별을 생성하여 무작위 속성 부여
    return Array.from({ length: 200 }).map((_, i) => {
      const animIndex = Math.floor(Math.random() * 3) + 1; // 1, 2, or 3
      return {
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2 + 0.5, // 0.5px ~ 2.5px
        duration: Math.random() * 8 + 3, // 3s ~ 11s (slower overall)
        delay: Math.random() * 5, // 0s ~ 5s
        blur: Math.random() * 1.5, // 0px ~ 1.5px blur
        animationName: `twinkle-${animIndex}`,
      };
    });
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
      {stars.map((star) => (
        <div
          key={star.id}
          className="absolute rounded-full bg-white"
          style={{
            left: `${star.x}vw`,
            top: `${star.y}vh`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            filter: `blur(${star.blur}px)`,
            animation: `${star.animationName} ${star.duration}s infinite alternate ease-in-out ${star.delay}s`
          }}
        />
      ))}
    </div>
  );
};
