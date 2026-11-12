import { cn } from '~/lib/utils';

/** Shimmer skeleton (§8.11). Static under reduced motion. */
const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return <div aria-hidden className={cn('skeleton rounded-xs', className)} {...props} />;
};

/** Skeleton rows at the final 56px row height so the layout doesn't jump. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('divide-y divide-border', className)} role='status' aria-label='Loading'>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className='flex h-14 items-center gap-3 px-4 sm:px-6'>
          <Skeleton className='size-8 rounded-full' />
          <div className='flex-1 space-y-2'>
            <Skeleton className='h-3 w-1/3' />
            <Skeleton className='h-2.5 w-1/5' />
          </div>
          <Skeleton className='h-3 w-16' />
        </div>
      ))}
    </div>
  );
}

export { Skeleton };
