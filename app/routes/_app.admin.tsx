import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';

// Old admin page — moved to /webadmin (separate URL with dedicated layout + login).
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  // Preserve query string (tab, q, etc.) when redirecting
  return redirect(`/webadmin${url.search}`);
}

export default function AdminRedirect() { return null; }
