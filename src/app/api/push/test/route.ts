import { NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/auth';
import { sendPushToUsers } from '@/lib/push';

export async function POST() {
  try {
    const { user, profile } = await getCurrentUserContext();

    if (!user || !profile || !profile.is_active) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();

    if (!publicKey || !privateKey) {
      return NextResponse.json(
        { error: 'VAPID keys are not configured in environment variables.' },
        { status: 400 }
      );
    }

    await sendPushToUsers([user.id], {
      title: 'Payment Desk — Test Alert',
      body: 'Lock-screen notifications are active on this device!',
      url: '/',
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Test push route error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send test alert.' },
      { status: 500 }
    );
  }
}
