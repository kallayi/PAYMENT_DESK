import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkAndDispatchDueReminders } from '@/lib/reminders-server';

export const dynamic = 'force-dynamic';

/**
 * Daily automated reminder check triggered by Vercel Cron (0 4 * * * UTC = 9:30 AM IST).
 * Fail-closed CRON_SECRET verification using constant-time comparison.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured.' },
      { status: 500 }
    );
  }

  const expectedHeader = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  const receivedHeader = Buffer.from(request.headers.get('authorization') || '', 'utf8');

  if (
    receivedHeader.length !== expectedHeader.length ||
    !crypto.timingSafeEqual(receivedHeader, expectedHeader)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await checkAndDispatchDueReminders();
    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Cron execution failed',
      },
      { status: 500 }
    );
  }
}
