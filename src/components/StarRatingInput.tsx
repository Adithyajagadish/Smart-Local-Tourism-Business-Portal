import React, { useState } from 'react';
import { Star } from 'lucide-react';

const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very Good',
  5: 'Exceptional',
};

interface StarRatingInputProps {
  value: number;
  onChange: (rating: number) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export const StarRatingInput: React.FC<StarRatingInputProps> = ({
  value,
  onChange,
  size = 'md',
  disabled = false,
}) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const activeRating = hovered ?? value;
  const iconClass = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <div className="inline-flex items-center gap-2">
      <div
        className="inline-flex items-center gap-1"
        role="radiogroup"
        aria-label="Star rating"
        onMouseLeave={() => setHovered(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = star <= activeRating;
          return (
            <button
              key={star}
              type="button"
              disabled={disabled}
              role="radio"
              aria-checked={value === star}
              aria-label={`Rate ${star} out of 5 stars`}
              onMouseEnter={() => {
                if (!disabled) setHovered(star);
              }}
              onClick={() => onChange(star)}
              className="p-0.5 rounded focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:opacity-50 transition-transform hover:scale-110"
            >
              <Star
                className={`${iconClass} ${
                  filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                }`}
              />
            </button>
          );
        })}
      </div>
      {activeRating >= 1 && activeRating <= 5 && (
        <span className="text-xs font-medium text-slate-600">
          {activeRating}/5 · {RATING_LABELS[activeRating]}
        </span>
      )}
    </div>
  );
};
