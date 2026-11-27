#!/usr/bin/env python3
"""Compose the Author-approved sex/age portrait pools using manual pixel commands.
Usage: python3 web/assets/compose-portrait-pool.py <cached original kit.png>
Requires Pillow. No network, model, randomness or simulation input is used.
"""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, PngImagePlugin

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[1])
EXPECTED = '6680b9144d9c2c7a60c123585064fab77715e5850f57b5e803a1c6faa7d9fd02'
if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != EXPECTED:
    raise ValueError('Not the independently inspected Character portrait kit original')
source = Image.open(SOURCE).convert('RGBA')
CELL, COLUMNS = 64, 16
SEXES = ['female', 'male', 'neutral']
AGES = ['baby', 'child', 'adult', 'elder', 'unknown']
SKINS = [
    ['#a3724f', '#c09062', '#ddaf7c'],
    ['#b9826a', '#dca18a', '#f0bd9f'],
    ['#a38d6f', '#bea986', '#e6cfac'],
    ['#523a30', '#795441', '#a47853'],
]
HAIRS = [
    ['#1e1714', '#33241d', '#59402c', '#76573c'],
    ['#2e1d16', '#4c3021', '#6f4c2b', '#8c663f'],
    ['#44251c', '#653723', '#8c4f2b', '#ac7041'],
]
CLOTHES = [
    ['#405753', '#607871', '#81938a'],
    ['#65463e', '#93675a', '#ba8c73'],
    ['#354d60', '#547084', '#7b95a0'],
    ['#745430', '#a67b45', '#c99e64'],
]
# Supplied source skin/hair colors, mapped to the same ID-bound destination family.
SKIN_SOURCE = {
    '#a39478': 0, '#b4a384': 1, '#dcc6a1': 2,
    '#cd955d': 0, '#e1a366': 1, '#ffc798': 2, '#d0ab87': 1,
}
HAIR_SOURCE = {'#2a2a2a': 0, '#3e3e3e': 1, '#676767': 2, '#8b8b8b': 3}
EYE_SOURCE = {'#812525': '#315a55', '#ac3232': '#4e6955', '#008080': '#315a55', '#4b692f': '#4e6955'}
HEADS = {
    'female': [(304, 525, 335, 562), (340, 525, 373, 558)],
    'male': [(305, 16, 330, 49), (345, 16, 378, 49)],
}
BODIES = {'female': (63, 432, 98, 469), 'male': (14, 14, 58, 50)}
FRAME = [
    ['rect', [0, 0, 63, 63], 'paper'],
    ['rect', [1, 1, 62, 62], 'ground'],
]
RAILS = [
    ['rect', [0, 0, 63, 1], 'frame'],
    ['rect', [0, 0, 1, 63], 'frame'],
    ['rect', [62, 0, 63, 63], 'frame'],
    ['rect', [0, 60, 63, 63], 'frame'],
    ['line', [2, 60, 61, 60], 'frameLight'],
]


def rgba(color):
    return tuple(bytes.fromhex(color.lstrip('#'))) + (255,)


def palette(index, cloth):
    skin, hair = SKINS[index % 4], HAIRS[index // 4]
    return {'skin.dark': skin[0], 'skin.mid': skin[1], 'skin.light': skin[2],
            **{f'hair.{i}': color for i, color in enumerate(hair)},
            'cloth.dark': CLOTHES[cloth][0], 'cloth.mid': CLOTHES[cloth][1], 'cloth.light': CLOTHES[cloth][2],
            'paper': '#f4ebd0', 'ground': '#e8dfc6', 'frame': '#30443d', 'frameLight': '#697b65',
            'ink': '#263b3c', 'eye': '#315a55', 'white': '#f8efd8'}


def commands(image, rows, colors, mask=None):
    layer = Image.new('RGBA', (CELL, CELL)) if mask is not None else image
    draw = ImageDraw.Draw(layer)
    for operation, coordinates, color in rows:
        fill = rgba(colors[color])
        if operation == 'poly':
            draw.polygon([tuple(point) for point in coordinates], fill=fill)
        elif operation == 'rect':
            draw.rectangle(coordinates, fill=fill)
        elif operation == 'line':
            draw.line(coordinates, fill=fill, width=1)
        elif operation == 'point':
            draw.point(coordinates, fill=fill)
        else:
            raise ValueError(f'Unknown recorded pixel operation {operation}')
    if mask is not None:
        layer.putalpha(Image.composite(layer.getchannel('A'), Image.new('L', (CELL, CELL)), mask))
        image.alpha_composite(layer)


def native_crop(rect):
    crop = source.crop(rect)
    crop.putdata([(0, 0, 0, 0) if pixel[:3] == (192, 192, 192) else pixel for pixel in crop.get_flattened_data()])
    return crop


def recolor(image, colors):
    replacements = {key: colors[['skin.dark', 'skin.mid', 'skin.light'][shade]] for key, shade in SKIN_SOURCE.items()}
    replacements.update({key: colors[f'hair.{shade}'] for key, shade in HAIR_SOURCE.items()})
    replacements.update(EYE_SOURCE)
    result = image.copy()
    result.putdata([rgba(replacements[key]) if (key := '#' + bytes(pixel[:3]).hex()) in replacements and pixel[3] else pixel
                    for pixel in image.get_flattened_data()])
    return result


def clothing(sex, variant):
    rows = [
        ['rect', [0, 33, 63, 63], 'cloth.mid'],
        ['rect', [0, 33, 20, 63], 'cloth.dark'],
        ['rect', [40, 33, 63, 63], 'cloth.light'],
        ['line', [21, 44, 21, 59], 'cloth.dark'],
        ['line', [42, 43, 42, 59], 'cloth.dark'],
    ]
    if sex == 'female' and variant == 0:
        rows += [
            ['rect', [27, 33, 36, 59], 'white'],
            ['poly', [[24, 33], [28, 37], [27, 59], [24, 59]], 'cloth.dark'],
            ['poly', [[39, 33], [35, 37], [36, 59], [39, 59]], 'cloth.dark'],
        ]
    else:
        rows += [
            ['poly', [[24, 33], [30, 35], [32, 39], [27, 37]], 'cloth.light'],
            ['poly', [[38, 33], [34, 35], [32, 39], [37, 37]], 'cloth.dark'],
            ['line', [32, 38, 32, 58 if variant == 0 else 46], 'cloth.dark'],
            ['point', [33, 42], 'white'], ['point', [33, 46], 'white'],
        ]
    return rows


def elder_lines(sex, variant):
    if sex == 'female':
        rows = [
            ['poly', [[30, 27], [36, 29], [43, 25], [43, 29], [37, 34], [30, 31]], 'skin.mid'],
            ['line', [34, 30, 40, 31], 'skin.dark'],
            ['line', [34, 16, 37, 16], 'skin.dark'],
            ['line', [41, 16, 44, 16], 'skin.dark'],
            ['line', [31, 11, 36, 11], 'skin.mid'],
            ['line', [38, 21, 41, 21], 'skin.dark'],
            ['line', [43, 19, 45, 20], 'skin.dark'],
            ['point', [44, 22], 'skin.dark'],
            ['line', [33, 29, 35, 31], 'skin.mid'],
            ['line', [30, 36, 34, 36], 'skin.dark'],
        ]
        if variant == 0:
            rows += [
                ['line', [32, 14, 38, 14], 'ink'], ['line', [32, 14, 32, 19], 'ink'],
                ['line', [32, 19, 38, 19], 'ink'], ['line', [38, 14, 38, 19], 'ink'],
                ['line', [40, 14, 46, 14], 'ink'], ['line', [40, 14, 40, 19], 'ink'],
                ['line', [40, 19, 46, 19], 'ink'], ['line', [46, 14, 46, 19], 'ink'],
                ['line', [38, 16, 40, 16], 'ink'], ['line', [36, 25, 35, 28], 'skin.mid'],
            ]
        return rows
    rows = [
        ['line', [27, 12, 34, 12], 'skin.mid'],
        ['line', [25, 22, 28, 22], 'skin.dark'],
        ['line', [36, 22, 39, 22], 'skin.dark'],
        ['line', [24, 24, 26, 26], 'skin.mid'],
        ['line', [38, 25, 36, 28], 'skin.mid'],
        ['line', [28, 33, 34, 33], 'skin.dark'],
    ]
    if variant == 0:
        rows += [
            ['line', [23, 17, 30, 17], 'ink'], ['line', [23, 17, 23, 23], 'ink'],
            ['line', [23, 23, 30, 23], 'ink'], ['line', [30, 17, 30, 23], 'ink'],
            ['line', [34, 17, 41, 17], 'ink'], ['line', [34, 17, 34, 23], 'ink'],
            ['line', [34, 23, 41, 23], 'ink'], ['line', [41, 17, 41, 23], 'ink'],
            ['line', [30, 19, 34, 19], 'ink'],
        ]
    return rows


def original_portrait(sex, age, variant):
    """Hand-authored integer pixels from an empty cell; no kit imagery is copied."""
    if age == 'unknown':
        return [
            ['poly', [[17, 57], [19, 45], [26, 40], [38, 40], [45, 45], [47, 57]], 'cloth.mid'],
            ['poly', [[25, 20], [28, 15], [36, 15], [40, 20], [40, 31], [36, 36], [29, 36], [25, 31]], 'skin.mid'],
            ['poly', [[25, 21], [25, 18], [29, 13], [36, 13], [40, 18], [40, 21], [36, 18], [29, 18]], 'hair.1'],
            ['line', [20, 56, 44, 56], 'cloth.dark'],
        ]
    if age == 'baby':
        return [
            ['poly', [[14, 40], [22, 33], [42, 33], [50, 40], [54, 59], [10, 59]], 'cloth.dark'],
            ['poly', [[18, 39], [27, 33], [44, 39], [49, 59], [18, 59]], 'cloth.light'],
            ['poly', [[17, 13], [23, 5], [41, 5], [47, 13], [49, 29], [41, 38], [23, 38], [15, 29]], 'skin.mid'],
            ['poly', [[21, 13], [26, 8], [39, 8], [44, 14], [45, 28], [39, 34], [25, 34], [20, 28]], 'skin.light'],
            ['poly', [[28, 10], [30, 6], [34, 5], [37, 8], [34, 10]], 'hair.1'],
            ['line', [24, 23, 28, 23 if variant == 0 else 22], 'ink'],
            ['line', [35, 23, 39, 23 if variant == 0 else 22], 'ink'],
            ['line', [30, 29, 33, 29], 'skin.dark'],
            ['line', [20, 43, 42, 57], 'cloth.mid'],
            ['line', [44, 40, 25, 56], 'cloth.mid'],
        ]
    child = age == 'child'
    top, chin, left, right = (5, 38, 16, 48) if child else (8, 35, 21, 43)
    rows = [
        ['poly', [[15, 59], [16, 46], [24, 39], [40, 39], [48, 46], [49, 59]] if child else [[11, 59], [13, 46], [23, 39], [41, 39], [51, 46], [53, 59]], 'cloth.dark'],
        ['poly', [[18, 59], [19, 46], [26, 41], [38, 41], [45, 46], [46, 59]] if child else [[15, 59], [17, 46], [25, 41], [39, 41], [47, 46], [49, 59]], 'cloth.mid'],
        ['rect', [28, chin - 2, 36, 43], 'skin.mid'],
        ['poly', [[left, top + 7], [left + 5, top], [right - 5, top], [right, top + 7], [right, chin - 6], [right - 6, chin], [left + 6, chin], [left, chin - 6]], 'skin.mid'],
        ['poly', [[left + 3, top + 7], [left + 7, top + 3], [right - 5, top + 3], [right - 2, top + 8], [right - 2, chin - 7], [right - 7, chin - 3], [left + 7, chin - 3], [left + 3, chin - 7]], 'skin.light'],
        ['poly', [[left - 1, top + 9], [left + 1, top + 3], [left + 6, top - 2], [right - 5, top - 2], [right + 1, top + 4], [right + 1, top + 10], [right - 6, top + 5], [left + 7, top + 6]], 'hair.1'],
        ['line', [left + 4, top + 3, right - 5, top + 2], 'hair.2'],
        ['rect', [24, 22, 27, 23], 'white'], ['point', [26, 22], 'ink'],
        ['rect', [35, 22, 38, 23], 'white'], ['point', [36, 22], 'ink'],
        ['line', [31, 24, 30, 27], 'skin.mid'], ['line', [29, 31, 34, 31], 'skin.dark'],
        ['poly', [[23, 40], [29, 44], [31, 48], [26, 45]], 'cloth.light'],
        ['poly', [[40, 40], [35, 44], [32, 48], [37, 45]], 'cloth.dark'],
    ]
    if sex == 'female' and child:
        rows += [
            ['poly', [[15, 17], [16, 31], [14, 39], [10, 35], [12, 20]], 'hair.0'],
            ['poly', [[48, 17], [51, 23], [53, 36], [48, 39], [47, 31]], 'hair.0'],
            ['rect', [11, 28, 15, 29], 'cloth.light'], ['rect', [48, 28, 52, 29], 'cloth.light'],
        ]
    elif variant == 1:
        rows += [['poly', [[24, top + 3], [28, top - 4], [34, top - 3], [38, top + 4]], 'hair.0']]
    if child:
        rows += [['line', [23, 46, 23, 59], 'cloth.light'], ['line', [41, 46, 41, 59], 'cloth.light'],
                 ['rect', [25, 51, 38, 57], 'cloth.light']]
    elif age == 'elder':
        rows += [['line', [26, 15, 36, 15], 'skin.mid'], ['line', [23, 25, 27, 25], 'skin.dark'],
                 ['line', [35, 25, 39, 25], 'skin.dark'], ['line', [27, 33, 35, 33], 'skin.mid']]
    return rows


atlas = Image.new('RGBA', (CELL * COLUMNS, CELL * 23))
templates, records = [], []
for sex_index, sex in enumerate(SEXES):
    for age_index, age in enumerate(AGES):
        for variant in range(2):
            template_id = len(templates)
            cloth = [0, 1][variant] if sex == 'female' else [2, 3][variant] if sex == 'male' else [2, 0][variant]
            adapted = sex != 'neutral' and age in ['adult', 'elder']
            template = {'id': template_id, 'sex': sex, 'age': age, 'variant': variant, 'cloth_palette': cloth,
                        'lineage': 'Character portrait kit' if adapted else 'project',
                        'license': 'CC-BY-4.0' if adapted else 'Apache-2.0',
                        'frame_before': FRAME, 'frame_after': RAILS}
            if adapted:
                body_rect, head_rect = BODIES[sex], HEADS[sex][variant]
                body_at = (14, 27) if sex == 'female' else (8, 28)
                head_at = ((CELL - (head_rect[2] - head_rect[0])) // 2, 1)
                body, head = native_crop(body_rect), native_crop(head_rect)
                base = Image.new('RGBA', (CELL, CELL))
                base.alpha_composite(body, body_at)
                base.alpha_composite(head, head_at)
                mask = Image.new('L', (CELL, CELL))
                mask.paste(body.getchannel('A'), body_at)
                template.update({'body_crop_xyxy': body_rect, 'body_at_xy': body_at,
                                 'head_crop_xyxy': head_rect, 'head_at_xy': head_at,
                                 'body_original_rgba_sha256': hashlib.sha256(source.crop(body_rect).tobytes()).hexdigest(),
                                 'head_original_rgba_sha256': hashlib.sha256(source.crop(head_rect).tobytes()).hexdigest(),
                                 'assembled_rgba_sha256': hashlib.sha256(base.tobytes()).hexdigest(),
                                 'ground_removal': 'Only exact source RGB #c0c0c0 becomes transparent.',
                                 'skin_source_replacements': SKIN_SOURCE, 'hair_source_replacements': HAIR_SOURCE,
                                 'eye_source_replacements': EYE_SOURCE,
                                 'cloth_commands_masked_by_body_alpha': clothing(sex, variant),
                                 'age_commands': elder_lines(sex, variant) if age == 'elder' else []})
            else:
                template.update({'creation': 'Original manually authored integer-pixel face, swaddle/clothes or age-indeterminate faceless silhouette from an empty cell. No source imagery copied.',
                                 'commands': original_portrait(sex, age, variant)})
            templates.append(template)
            for palette_index in range(12):
                index = ((sex_index * 5 + age_index) * 2 + variant) * 12 + palette_index
                colors = palette(palette_index, cloth)
                image = Image.new('RGBA', (CELL, CELL))
                commands(image, FRAME, colors)
                if adapted:
                    body_image = recolor(body, colors)
                    image.alpha_composite(body_image, body_at)
                    commands(image, template['cloth_commands_masked_by_body_alpha'], colors, mask)
                    image.alpha_composite(recolor(head, colors), head_at)
                    commands(image, template['age_commands'], colors)
                else:
                    commands(image, template['commands'], colors)
                commands(image, RAILS, colors)
                x, y = index % COLUMNS * CELL, index // COLUMNS * CELL
                atlas.alpha_composite(image, (x, y))
                records.append({'id': index, 'template': template_id, 'palette': palette_index,
                                'destination_xywh': [x, y, CELL, CELL],
                                'rgba_sha256': hashlib.sha256(image.tobytes()).hexdigest()})

meta = PngImagePlugin.PngInfo()
meta.add_text('Artist', "Dezra's Dragons; manual adaptations and original gaps by Back in the Family")
meta.add_text('Source', 'https://opengameart.org/content/character-portrait-kit')
meta.add_text('Copyright', 'Source-derived adult/elder cells: CC-BY 4.0 https://creativecommons.org/licenses/by/4.0/ ; https://opengameart.org/users/dezrasdragons ; original cells: Apache-2.0. See /credits.html.')
meta.add_text('Description', '360 64px sex/age/palette portrait cells. Manual source crops, modern clothes, stable skin/hair palettes and elder lines; original baby/child/neutral/unknown-age cells; flat frame rails. No AI or RNG.')
out = ROOT / 'web/public/assets/life-portraits.png'
atlas.save(out, pnginfo=meta, compress_level=9)
provenance = {
    'scope': 'Author-approved local portrait rollout; illustration pools do not alter recorded sex, age or game rules.',
    'source': {'name': 'Character portrait kit', 'creator': "Dezra's Dragons", 'profile': 'https://opengameart.org/users/dezrasdragons',
               'page': 'https://opengameart.org/content/character-portrait-kit',
               'original': 'https://opengameart.org/sites/default/files/dezras_dragons_portrait_kit.png',
               'original_sha256': EXPECTED, 'original_bytes': SOURCE.stat().st_size, 'original_dimensions': [616, 904],
               'license': 'CC-BY-4.0', 'license_path': 'web/assets/licenses/CC-BY-4.0.txt',
               'notice_path': 'web/assets/licenses/character-portrait-kit-NOTICE.txt',
               'original_embedded_notices': 'No supplied text/creator/license chunks; source-page creator/profile notice is retained separately.'},
    'original_license': {'license': 'Apache-2.0', 'path': 'LICENSE', 'cells': 'Baby/child/neutral/unknown-age faces and modern frame rails are manually authored original pixel work; no kit imagery is copied into original cells.'},
    'model': {'cell': CELL, 'columns': COLUMNS, 'sex_order': SEXES, 'age_order': AGES,
              'age_thresholds': {'baby': '0-2', 'child': '3-17', 'adult': '18-59', 'elder': '60+', 'unknown': 'age=null'},
              'palette': 'person % 12', 'skin': 'palette % 4', 'hair': 'floor(palette / 4)',
              'variant': 'floor(person / 12) % 2', 'id': '((sexIndex * 5 + ageIndex) * 2 + variant) * 12 + palette',
              'continuity': 'The exact same skin/hair RGB families remain ID-bound across every age and sex pool. No gray-hair aging substitution. Unknown sex selects neutral; unknown age selects faceless age-indeterminate cells.',
              'scaling': '64px cells and scenery use the same positive integer source-pixel scale; no fractional resampling.',
              'no_rng': True, 'skin_palettes_dark_mid_light': SKINS, 'hair_palettes_dark_mid_light_highlight': HAIRS, 'cloth_palettes': CLOTHES},
    'atlas': {'path': 'assets/life-portraits.png', 'dimensions': list(atlas.size), 'bytes': out.stat().st_size,
              'sha256': hashlib.sha256(out.read_bytes()).hexdigest(), 'cells': len(records)},
    'method': 'Manual integer-pixel composition through Pillow. Template crop rectangles, exact palette replacements, masked/unmasked drawing commands and frame rails plus per-cell RGBA hashes fully specify modifications. No generation, network, model, random choice, source resampling or preview/comment art.',
    'templates': templates, 'cells': records,
}
(ROOT / 'web/assets/portrait-pool-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
print(json.dumps({'atlas': provenance['atlas'], 'templates': len(templates), 'adapted_cells': sum(12 for template in templates if template['lineage'] == 'Character portrait kit')}))
