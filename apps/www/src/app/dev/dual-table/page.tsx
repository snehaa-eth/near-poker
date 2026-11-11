import { redirect } from 'next/navigation';

/** Old dual preview → single table page. */
export default function DualTableRedirect() {
  redirect('/dev/table');
}
