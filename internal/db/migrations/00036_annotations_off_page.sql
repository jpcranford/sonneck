-- +goose Up
-- Marks wholly off the page are never stored (repo.NormalizeMarks drops
-- them): clear any saved before that rule. A stroke stays when any of its
-- points is on the page; a text mark when its left edge is on the page and
-- its baseline no more than one text size (a percent of the page's width)
-- below it — repo.StrokeTouchesPage and repo.TextOnPage. A page left with
-- no marks loses its row.
UPDATE piece_annotations SET marks = (
    SELECT json_group_array(json(m.value) ORDER BY m.key)
    FROM json_each(piece_annotations.marks) m
    WHERE CASE json_extract(m.value, '$.kind')
        WHEN 'stroke' THEN EXISTS (
            SELECT 1 FROM json_each(json_extract(m.value, '$.points')) p
            WHERE json_extract(p.value, '$[0]') BETWEEN 0 AND 1
              AND json_extract(p.value, '$[1]') BETWEEN 0 AND 1)
        WHEN 'text' THEN json_extract(m.value, '$.x') BETWEEN 0 AND 1
            AND json_extract(m.value, '$.y') BETWEEN 0 AND 1 + json_extract(m.value, '$.size') / 100.0
        ELSE 1
    END
);
DELETE FROM piece_annotations WHERE json_array_length(marks) = 0;

-- +goose Down
-- The removed marks aren't kept.
SELECT 1;
