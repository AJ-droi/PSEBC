CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_channel";--> statement-breakpoint
DROP INDEX "notifications_outbox_idx";--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "incident_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_outbox_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."delivered" = false AND "notifications"."channel" IN ('email', 'sms', 'push');--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_channel" CHECK ("notifications"."channel" IN ('in_app', 'email', 'sms', 'phone_task', 'push'));