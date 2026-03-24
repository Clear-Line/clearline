/** clerkclerkMiddleware() grants you access to user authentication state throughout your app. 
 * It also allows you to protect specific routes from unauthenticated users
 */

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/markets(.*)',
  '/api/pipeline(.*)',
  '/api/analysis(.*)',
  '/api/analytics(.*)',
  '/api/alerts(.*)',
  '/market(.*)',
  '/news(.*)',
  '/wallets(.*)',
  '/alerts(.*)',
  '/accuracy(.*)',
  '/about(.*)',
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
