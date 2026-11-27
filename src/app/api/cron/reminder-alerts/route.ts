import { NextRequest, NextResponse } from 'next/server';
import { checkAndDispatchDueReminders } from '@/actions/reminders';

export const dynamic = 'force-dynamic';

/**
 * Daily automated reminder check triggered by Vercel Cron (0 4 * * * UTC = 9:30 AM IST).
 * Evaluates all active monthly recurring reminders due today or earlier this month (IST)
 * and dispatches in-app + Web Push notifications strictly to Accounts (PREPARER) & Admin users.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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
