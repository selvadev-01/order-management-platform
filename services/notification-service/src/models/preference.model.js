/**
 * Push prompt preference (US-NOTIF-5).
 *
 * Records that a user dismissed the browser's permission prompt, so the app
 * stops re-asking on every login.
 *
 * Stored server-side rather than in localStorage because the decision belongs
 * to the person, not the browser profile: clearing site data, using a second
 * device, or a private window would otherwise resurrect the prompt they
 * already declined.
 *
 * Deliberately NOT a record of the browser permission itself — that lives in
 * the browser and is the only authority on whether push can be sent. This
 * tracks one thing: whether we should ask again.
 */
import mongoose from 'mongoose';

const preferenceSchema = new mongoose.Schema(
  {
    // One row per user: the preference follows the person across devices.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    /**
     * Set when the user dismissed or declined the prompt. While true the app
     * does not prompt again; subscribing from any device clears it, since
     * that is the user changing their mind.
     */
    promptDeclined: { type: Boolean, default: false },
    declinedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const PushPreference = mongoose.model('PushPreference', preferenceSchema);