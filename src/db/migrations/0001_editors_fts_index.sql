CREATE VIRTUAL TABLE `editors_fts_index` USING fts5(
	`editor_id` UNINDEXED,
	`content`
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `editors_fts_vocab` USING fts5vocab(editors_fts_index, row);
