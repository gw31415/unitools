CREATE VIRTUAL TABLE `editors_fts_index` USING fts5(
	`editor_id` UNINDEXED,
	`content`
);
