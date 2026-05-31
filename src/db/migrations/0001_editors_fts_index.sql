CREATE VIRTUAL TABLE `editors_fts_index` USING fts5(
	`editor_id` UNINDEXED,
	`content`
);
CREATE VIRTUAL TABLE `editors_fts_vocab` USING fts5vocab(editors_fts_index, row);
