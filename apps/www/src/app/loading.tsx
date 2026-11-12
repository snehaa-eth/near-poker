import { OrbitLoader } from '~/components/ui/orbit-loader';

export default function Loading() {
  return (
    <div className='flex min-h-[100dvh] items-center justify-center px-4 pt-nav'>
      <OrbitLoader caption='Loading the arena' size={240} />
    </div>
  );
}
