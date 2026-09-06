CREATE TYPE "public"."sentiment_label" AS ENUM('encouraged', 'neutral', 'discouraged', 'stale_or_duplicate');--> statement-breakpoint
CREATE TABLE "issue_scores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "issue_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"watched_repo_id" text NOT NULL,
	"issue_number" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"state" text NOT NULL,
	"github_updated_at" timestamp with time zone NOT NULL,
	"has_assignee" boolean DEFAULT false NOT NULL,
	"open_competing_pr_count" integer DEFAULT 0 NOT NULL,
	"abandoned_pr_count" integer DEFAULT 0 NOT NULL,
	"sentiment_label" "sentiment_label",
	"sentiment_rationale" text,
	"score" integer NOT NULL,
	"reasons" jsonb NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_repos" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"label_filter" text[] DEFAULT '{"good first issue"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_refreshed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "issue_scores" ADD CONSTRAINT "issue_scores_watched_repo_id_watched_repos_id_fk" FOREIGN KEY ("watched_repo_id") REFERENCES "public"."watched_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_scores_repo_issue_idx" ON "issue_scores" USING btree ("watched_repo_id","issue_number");--> statement-breakpoint
CREATE INDEX "watched_repos_owner_name_idx" ON "watched_repos" USING btree ("owner","name");