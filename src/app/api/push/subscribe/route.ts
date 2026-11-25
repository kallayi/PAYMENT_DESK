import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';

const subscribeSchema = z.object({
  endpoint: z.string().url('Valid push subscription endpoint URL is required.'),
  keys: z.object({
    p256dh: z.string().min(1, 'p256dh key is required.'),
    auth: z.string().min(1, 'auth key is required.'),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url('Valid push subscription endpoint URL is required.'),
});

export async function POST(req: NextRequest) {
  try {
    const { user, profile } = await getCurrentUserContext();

    if (!user || !profile || !profile.is_active) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid subscription payload.' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: user.id,
          endpoint: parsed.data.endpoint,
          p256dh: parsed.data.keys.p256dh,
          auth: parsed.data.keys.auth,
        },
        { onConflict: 'endpoint' }
      );

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Failed to save push subscription.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Subscription error.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, profile } = await getCurrentUserContext();

    if (!user || !profile || !profile.is_active) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = unsubscribeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid unsubscribe payload.' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', parsed.data.endpoint)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Failed to remove push subscription.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unsubscribe error.' },
      { status: 500 }
    );
  }
}
