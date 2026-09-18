CREATE TYPE "public"."claim_draft_status" AS ENUM('abstained', 'pending_review', 'approved', 'posted', 'rejected');--> statement-breakpoint
CREATE TABLE "claim_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"watched_repo_id" text NOT NULL,
	"issue_number" integer NOT NULL,
	"status" "claim_draft_status" NOT NULL,
	"gate_reasons" jsonb NOT NULL,
	"gate_snapshot" jsonb NOT NULL,
	"llm_abstain_reason" text,
	"draft_comment" text,
	"posted_comment_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "claim_drafts" ADD CONSTRAINT "claim_drafts_watched_repo_id_watched_repos_id_fk" FOREIGN KEY ("watched_repo_id") REFERENCES "public"."watched_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_drafts_watched_repo_idx" ON "claim_drafts" USING btree ("watched_repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_drafts_repo_issue_idx" ON "claim_drafts" USING btree ("watched_repo_id","issue_number");