'use client';

import { useState } from 'react';

import { motion } from 'framer-motion';
import { PokerCard } from '~/components';

const tabs = [
  {
    id: 'hand',
    label: 'Hand',
  },
  {
    label: 'Off-Hand',
    id: 'off-hand',
  },
] as const;

interface PlayerCardsProps {
  cards: number[];
}

export const PlayerCards = ({ cards }: PlayerCardsProps) => {
  const maxRotation = 20;
  const filteredCards = cards.filter((c) => c !== undefined && c !== null);
  const midIndex = (filteredCards.length - 1) / 2;
  const [activeTab, setActiveTab] = useState<'hand' | 'off-hand'>('hand');

  if (filteredCards.length === 0) return null;

  return (
    <>
      <div className='absolute bottom-0 right-1/2 z-[3] translate-x-1/2 overflow-y-hidden'>
        <div className='flex h-[24rem] w-[66rem] flex-row items-end justify-center gap-2'>
          {filteredCards.map((card, index) => {
            const relativeIndex = index - midIndex;
            const rotation =
              midIndex === 0 ? 0 : relativeIndex * (maxRotation / midIndex);
            const translateY = Math.pow(Math.abs(relativeIndex), 2) * 15 + 10;
            const translateX = relativeIndex * -60;

            return (
              <motion.div
                key={`${card}-${index}`}
                transition={{ type: 'spring', stiffness: 100 }}
                animate={{
                  translateX: activeTab === 'hand' ? translateX : 0,
                  translateY: activeTab === 'hand' ? translateY : -100,
                  rotateZ: activeTab === 'hand' ? rotation : 0,
                }}
                style={{
                  zIndex: 3,
                }}
              >
                <PokerCard cardId={card} className='w-36' />
              </motion.div>
            );
          })}
        </div>
      </div>
      <div className='absolute bottom-0 right-1/2 z-[4] translate-x-1/2'>
        <div className='mb-6 flex flex-row items-center space-x-1 rounded-3xl bg-neutral-800 px-2 py-2'>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type='button'
              className={`${
                activeTab === tab.id ? '' : 'hover:text-white/60'
              } relative rounded-full px-3 py-1.5 text-sm font-medium text-white outline-sky-400 transition focus-visible:outline-2`}
              style={{
                WebkitTapHighlightColor: 'transparent',
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {activeTab === tab.id && (
                <motion.span
                  className='absolute inset-0 z-10 bg-white mix-blend-difference'
                  layoutId='bubble'
                  style={{ borderRadius: 9999 }}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};
