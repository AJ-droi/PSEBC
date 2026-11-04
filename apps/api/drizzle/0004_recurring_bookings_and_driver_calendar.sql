CREATE TABLE "driver_days_off" (
	"driver_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_days_off_driver_id_day_pk" PRIMARY KEY("driver_id","day")
);
--> statement-breakpoint
CREATE TABLE "ride_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "driver_days_off" ADD CONSTRAINT "driver_days_off_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_series" ADD CONSTRAINT "ride_series_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_series" ADD CONSTRAINT "ride_series_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_days_off_day_idx" ON "driver_days_off" USING btree ("day");--> statement-breakpoint
CREATE INDEX "ride_series_member_idx" ON "ride_series" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_series_id_ride_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."ride_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rides_series_idx" ON "rides" USING btree ("series_id","pickup_at") WHERE "rides"."series_id" IS NOT NULL;