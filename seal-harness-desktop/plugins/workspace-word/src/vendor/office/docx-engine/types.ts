/** author/date of one tracked change (a w:ins or w:del wrapper). */
export interface RevisionInfo {
  author: string;
  /** ISO timestamp from w:date */
  date?: string | undefined;
  /** original w:id, kept so an edited paragraph re-emits stable ids */
  id?: string | undefined;
}

/** A styled text run inside a paragraph-like block. */
export interface Run {
  text: string;
  /**
   * Original <w:rPr> slice (serialized from the parse tree). Written back via
   * mergeRPrModel when the run is rebuilt: unmodeled properties (caps/vanish/dstrike/
   * bdr/double underline/themeColor/all four rFonts slots…) are kept verbatim, and
   * modeled fields are only rebuilt when they differ from the raw encoding (i.e. edited).
   */
  rawRPr?: string | undefined;
  /** character style id (w:rStyle); "Hyperlink" is implied by `link` and never stored here */
  styleId?: string | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  underline?: boolean | undefined;
  strike?: boolean | undefined;
  /** hex color without '#', e.g. "FF0000"; 'auto' = explicit w:color auto (Word's automatic
   * colour, overrides an inherited style colour; rendered as the default ink) */
  color?: string | undefined;
  /** font size in half-points (OOXML w:sz) */
  sizeHalfPoints?: number | undefined;
  /** primary font family (w:rFonts, eastAsia ?? ascii ?? hAnsi) */
  font?: string | undefined;
  /** `font` is a backfill for an empty EA theme slot (<a:ea typeface=""/>), not a document choice
   * (display keeps the Word-look face; line metrics follow the theme's Latin face like LO) */
  eaSlotEmpty?: boolean | undefined;
  /** Latin-slot font (w:rFonts ascii/hAnsi) when the run declares one; may equal `font`.
   * Kept separate so editing one script's font never flattens the other slot. */
  fontAscii?: string | undefined;
  /** the run's own East Asian slot (display-only; `font` falls back to the Latin slots) */
  eastAsiaFont?: string | undefined;
  /** w:lang w:eastAsia of the run or its character style (display-only: Word applies
   *  kinsoku / hanging / punctuation compression only under a CJK East Asian language) */
  eastAsiaLang?: string | undefined;
  /** complex-script-slot font (w:rFonts w:cs, literal attribute only — theme refs stay in rawRPr) */
  fontCs?: string | undefined;
  /** font/fontAscii values that were resolved from theme refs at parse time; generate
   * treats model == resolved as untouched so the raw theme attrs are not materialized */
  themeRFonts?: { font?: string | undefined; fontAscii?: string | undefined } | undefined;
  /** color value resolved from a w:themeColor ref at parse time; generate treats
   * model == resolved as untouched so the raw theme attrs (and cached w:val) survive */
  themeColor?: string | undefined;
  /** Complex-script font (w:rFonts cs/cstheme, theme-resolved). Display only; saving is kept faithful by rawRPr */
  csFont?: string | undefined;
  /** right-to-left run (w:rtl): text stored in logical order, rendered RTL */
  rtl?: boolean | undefined;
  /** Character spacing (w:spacing, twips, may be negative). Display only; saving is kept faithful by rawRPr */
  charSpacingTwips?: number | undefined;
  /** w:kern threshold in half-points (0 = explicitly off). Display only; saving is kept faithful by rawRPr */
  kernHalfPoints?: number | undefined;
  /** w:caps ('all') / w:smallCaps ('small') display transform, 'none' = explicit off. Display only; saving is kept faithful by rawRPr */
  caps?: ('all' | 'small' | 'none') | undefined;
  /** w:vanish hidden text, resolved through the style chain at parse (an explicit
   *  run value wins; w:specVanish style separators stay visible). Display only;
   *  saving is kept faithful by rawRPr */
  vanish?: boolean | undefined;
  /** Horizontal character scale percent (w:w). Display only (approximated as spacing); saving is kept faithful by rawRPr */
  charScalePct?: number | undefined;
  /** OOXML named highlight color (w:highlight), e.g. "yellow" */
  highlight?: string | undefined;
  /** character shading fill, hex without '#' (w:shd w:fill, non-auto); highlight wins when both are set */
  shading?: string | undefined;
  /** rtl run (explicit w:rtl, or inherited from its style chain): bold/italic/size
   * were read from the Cs twins (w:bCs/w:iCs/w:szCs) */
  cs?: boolean | undefined;
  /** superscript / subscript (w:vertAlign) */
  vertAlign?: ('superscript' | 'subscript') | undefined;
  /** East Asian emphasis mark (w:em). Display only; saving is kept faithful by rawRPr */
  em?: ('dot' | 'comma' | 'circle' | 'underDot') | undefined;
  /** hyperlink info; rId references an existing relationship in the original docx */
  link?: { href: string; rId?: string | undefined; tooltip?: string | undefined } | undefined;
  /**
   * ids of comments whose range covers this run. Only set when the whole
   * commentRangeStart..End pair lives inside the same paragraph, so an edited
   * paragraph can re-emit the markers without touching its neighbors.
   */
  commentIds?: string[] | undefined;
  /** run is inside a w:ins (tracked insertion) */
  ins?: RevisionInfo | undefined;
  /** run is inside a w:del (tracked deletion; text came from w:delText) */
  del?: RevisionInfo | undefined;
  /**
   * The run is a footnote/endnote reference marker (w:footnoteReference /
   * w:endnoteReference). `text` holds the display number; the marker itself
   * is what saves (Word renumbers automatically).
   */
  noteRef?: { kind: 'footnote' | 'endnote'; id: string } | undefined;
  /**
   * An index entry (XE) field attached AFTER this run's text. Invisible in
   * Word; kept in the run model so marked paragraphs stay editable.
   */
  xeTerm?: string | undefined;
  /**
   * The run is a cross-reference (REF field) to the named bookmark; `text`
   * holds the cached display result. Regenerates as a full REF field.
   */
  refField?: string | undefined;
  /** exact original REF instruction text; written back verbatim so switches (\r, \p, ...) survive */
  refInstr?: string | undefined;
  /** Generic inline field (DATE/TIME/NUMPAGES/FILENAME etc.): full instruction text; run text is the cached result */
  instrField?: string | undefined;
  /** Original field-begin run XML (w:fldChar + w:ffData), written back verbatim so form-field
   * definitions survive; when set, the run text is a synthesized glyph (☐/☒), not a cached result */
  fldBeginXml?: string | undefined;
  /**
   * Run-level formatting revision (w:rPrChange): records the review info and the modeled
   * subset of the pre-revision formatting. Accept = keep the current formatting and clear
   * the record; reject = restore the formatting from `old` and clear the record.
   */
  rPrChange?:
    | (RevisionInfo & {
        old?:
          | {
              bold?: boolean | undefined;
              italic?: boolean | undefined;
              underline?: boolean | undefined;
              strike?: boolean | undefined;
              color?: string | undefined;
              sizeHalfPoints?: number | undefined;
              font?: string | undefined;
              fontAscii?: string | undefined;
              charSpacingTwips?: number | undefined;
              charScalePct?: number | undefined;
              highlight?: string | undefined;
              vertAlign?: ('superscript' | 'subscript') | undefined;
              styleId?: string | undefined;
            }
          | undefined;
      })
    | undefined;
  /**
   * The run is an atomic inline formula. `text` holds the flat OMML token
   * strip (previews / word count); `omml` is the exact <m:oMath> fragment,
   * emitted verbatim when the paragraph regenerates.
   */
  math?: { omml: string } | undefined;
  /**
   * Phonetic guide (w:ruby). `text` holds the base characters; `rt` the
   * phonetic text; `xml` the exact <w:ruby> fragment, re-wrapped in a w:r
   * and emitted verbatim when the paragraph regenerates.
   */
  ruby?: { rt: string; xml: string } | undefined;
  /**
   * Picture carried by this run (table cell, or a paragraph mixing text and
   * pictures). `dataUrl` is for display; `xml` is the exact <w:drawing>
   * fragment, re-wrapped in a w:r and emitted verbatim on regeneration.
   * `wrap`/offsets are display-only anchor geometry of a floating picture
   * (wp:anchor); absent = inline.
   */
  image?:
    | {
        dataUrl: string;
        widthPx?: number | undefined;
        heightPx?: number | undefined;
        xml: string;
        wrap?: ImageWrap | undefined;
        offsetXEmu?: number | undefined;
        offsetYEmu?: number | undefined;
        /** wp:anchor text-wrap distances (EMU; display-only) */
        wrapDistTopEmu?: number | undefined;
        wrapDistBottomEmu?: number | undefined;
        wrapDistLeftEmu?: number | undefined;
        wrapDistRightEmu?: number | undefined;
        /** wp:anchor allowOverlap="0" (display-only collision hint) */
        noOverlap?: boolean | undefined;
        /** picture outline (pic:spPr a:ln solid fill, display-only) */
        border?: { color: string; widthPt: number } | undefined;
        /** wp:positionV relativeFrom="line" align="center": the floating picture
         *  centers on its anchor line instead of hanging below it (display-only) */
        lineCenterV?: boolean | undefined;
        /** pic a:xfrm rot in degrees clockwise 0-359 / flipH / flipV (display-only; the xml saves verbatim) */
        rotDeg?: number | undefined;
        flipH?: boolean | undefined;
        flipV?: boolean | undefined;
        /** VML horizontal rule (v:rect o:hr), alone or sharing the paragraph with text:
         *  drawn as a rule on a line of its own like Word (dataUrl is empty). The line is
         *  as tall as the rule run's own font (sizeHalfPoints = the run's w:sz), not the
         *  paragraph's tallest run; widthPx/align only when the style declares a width
         *  (width:0 = full column width) */
        rule?:
          | {
              colorHex?: string | undefined;
              thicknessPx?: number | undefined;
              sizeHalfPoints?: number | undefined;
              widthPx?: number | undefined;
              align?: ('center' | 'right') | undefined;
            }
          | undefined;
      }
    | undefined;
}

/** One comment from word/comments.xml (read-only display model). */
export interface CommentInfo {
  id: string;
  author: string;
  initials?: string | undefined;
  /** ISO timestamp from w:date */
  date?: string | undefined;
  /** plain text, paragraphs joined with \n */
  text: string;
  /** Reply: the parent comment's w:id (resolved via the paraId relation in commentsExtended) */
  parentId?: string | undefined;
  /** Resolved (w15:done) */
  done?: boolean | undefined;
  /** w14:paraId of the comment's last paragraph (the commentsExtended link key; assigned on save for new comments) */
  paraId?: string | undefined;
}

export type ParaAlign = 'left' | 'center' | 'right' | 'justify' | 'distribute';

/**
 * Preserved shell of a structured document tag (w:sdt) wrapping this block.
 * The original <w:sdt>…<w:sdtPr>…</w:sdtPr>…<w:sdtContent> opening bytes and
 * the closing </w:sdtContent></w:sdt> bytes are stored here so that saving can
 * re-wrap the regenerated paragraph XML in the original SDT shell (byte-fidelity rule).
 */
export interface SdtShell {
  /** human-visible alias label (w:sdtPr/w:alias @w:val), may be empty */
  alias: string;
  /** programmatic tag (w:sdtPr/w:tag @w:val), may be empty */
  tag: string;
  /**
   * control type: 'text' = plain/rich text, 'date' = date picker,
   * 'dropdown' = drop-down list/combo box, 'checkbox' = Word 2013 checkbox,
   * 'unknown' = unrecognised sdtPr content
   */
  controlType: 'text' | 'date' | 'dropdown' | 'checkbox' | 'unknown';
  /**
   * Original XML bytes from the opening <w:sdt> up to and including the
   * <w:sdtContent> tag (i.e. everything BEFORE the paragraph content).
   * This is emitted verbatim before the regenerated paragraph XML on save.
   */
  openXml: string;
  /**
   * Closing bytes "</w:sdtContent></w:sdt>" (emitted after the paragraph XML).
   */
  closeXml: string;
  /**
   * Set when one w:sdt was split into several blocks (multi-paragraph
   * sdtContent, e.g. a Word TOC). Blocks sharing a group belong to the same
   * sdt; only the first carries openXml and only the last carries closeXml.
   */
  group?: number | undefined;
}

/** One custom tab stop from w:tabs/w:tab. Positions are in twips. */
export interface TabStop {
  /** position in twips (w:pos); percent of the text column when rel is set */
  pos: number;
  /** tab alignment (w:val) */
  val: 'left' | 'center' | 'right' | 'decimal' | 'bar' | 'clear';
  /** leader character (w:leader): none/dot/hyphen/underscore/heavy/middleDot */
  leader?: ('none' | 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot') | undefined;
  /** display-only stop synthesized from a w:ptab (absolute position tab):
   *  pos is a percent of the column width. Never written back to w:tabs. */
  rel?: 'margin' | undefined;
}

/** Declared look of one w:pBdr side. */
export interface ParaBorderLine {
  /** hex without '#' (w:color); undefined = auto */
  color?: string | undefined;
  /** line width in pt (w:sz eighth-points / 8) */
  szPt?: number | undefined;
}

/** per-side w:pBdr lines; null = explicit none/nil (cancels a basedOn parent's side) */
export type ParaBorderSides = Partial<Record<'t' | 'b' | 'l' | 'r', ParaBorderLine | null>>;

/** Paragraph-level formatting that survives regeneration (subset of w:pPr). */
/**
 * Absolutely positioned paragraph frame (w:framePr). All lengths in twips;
 * x/y measure from the anchor's top-left (page anchors by default). Height is
 * auto unless hTwips is set — auto frames grow with substituted-font wrap
 * instead of clipping.
 */
export interface ParaFrame {
  /** frame width (w:w); text wraps inside it */
  wTwips: number;
  /** frame height (w:h); omit for auto height */
  hTwips?: number | undefined;
  /** height rule, only written with hTwips (default 'atLeast') */
  hRule?: ('atLeast' | 'exact') | undefined;
  /** x offset from the hAnchor's left edge (w:x) */
  xTwips: number;
  /** y offset from the vAnchor's top edge (w:y) */
  yTwips: number;
  /** horizontal anchor (w:hAnchor, default 'page') */
  hAnchor?: ('page' | 'margin' | 'text') | undefined;
  /** vertical anchor (w:vAnchor, default 'page') */
  vAnchor?: ('page' | 'margin' | 'text') | undefined;
  /** body-text wrapping around the frame (w:wrap, default 'none') */
  wrap?: ('none' | 'around' | 'through' | 'notBeside' | 'auto') | undefined;
}

/**
 * Character-unit indents a w:ind specifies (w:leftChars / w:rightChars /
 * w:firstLineChars / w:hangingChars), in hundredths of a character — the way
 * CJK documents express "first-line indent: 2 characters". An explicit 0 is
 * recorded as such: Word writes it to mean "this indent is absolute", and it
 * cancels the value inherited from a parent style.
 */
export interface CharIndents {
  left?: number | undefined;
  right?: number | undefined;
  firstLine?: number | undefined;
  hanging?: number | undefined;
}

export interface ParaFormat {
  /** w:jc */
  align?: ParaAlign | undefined;
  /** line spacing as a multiple of single (w:spacing w:line / 240, lineRule="auto") */
  lineSpacing?: number | undefined;
  /**
   * F1 precise line-height rule (from w:spacing w:lineRule):
   * 'auto'    = multiple spacing; lineSpacing is the multiplier (e.g. 1.0 = single, 1.5 = 1.5x)
   * 'atLeast' = line height at least N twips (lineRawTwips), else the font's natural height
   * 'exact'   = fixed line height of N twips (lineRawTwips), never expands
   * undefined = same as 'auto' (backward compatible)
   */
  lineRule?: ('auto' | 'atLeast' | 'exact') | undefined;
  /** raw w:spacing w:line value in twips (used in atLeast/exact modes) */
  lineRawTwips?: number | undefined;
  /** left indent in twips (w:ind w:left); an explicit 0 is kept — it cancels a style or numbering indent */
  indentLeft?: number | undefined;
  /** right indent in twips (w:ind w:right); explicit 0 kept */
  indentRight?: number | undefined;
  /** first-line indent in twips; positive = w:firstLine, negative = w:hanging, explicit 0 kept.
   *  Character-unit indents (w:firstLineChars…) are already resolved into these
   *  twips fields at parse time — see resolveCharIndents. */
  indentFirstLine?: number | undefined;
  /** the active character-unit indents (direct w:ind or style chain) the twips
   *  fields above were resolved from. Parse-side only: a save that rebuilds w:ind
   *  writes the matching `*Chars="0"` for them (mergePPrFormat), or Word keeps
   *  preferring the character indent over the new twips value on reload. */
  charIndents?: CharIndents | undefined;
  /** space above the paragraph in twips (w:spacing w:before) */
  spaceBefore?: number | undefined;
  /** space below the paragraph in twips (w:spacing w:after) */
  spaceAfter?: number | undefined;
  /** w:beforeAutospacing: Word ignores the literal and uses its HTML auto value (14pt) */
  spaceBeforeAuto?: boolean | undefined;
  /** w:afterAutospacing: Word ignores the literal and uses its HTML auto value (14pt) */
  spaceAfterAuto?: boolean | undefined;
  /** start the paragraph on a new page (w:pageBreakBefore) */
  pageBreakBefore?: boolean | undefined;
  /** keep this paragraph on same page as the next paragraph (w:keepNext) */
  keepNext?: boolean | undefined;
  /** keep all lines of this paragraph on the same page (w:keepLines) */
  keepLines?: boolean | undefined;
  /** widow/orphan control (w:widowControl; Word default=true) */
  widowControl?: boolean | undefined;
  /** snap lines to the section docGrid (w:snapToGrid; default on) — false only when explicitly off */
  snapToGrid?: boolean | undefined;
  /** CJK-Latin/digit auto spacing (w:autoSpaceDE/DN; Word default=true); false when both are explicitly off */
  autoSpace?: boolean | undefined;
  /** w:wordWrap (Word default on); false = lines may break inside hangul words */
  wordWrap?: boolean | undefined;
  /** w:overflowPunct (Word default on); false = a trailing CJK stop never hangs past the margin */
  overflowPunct?: boolean | undefined;
  /** paragraph-style chain w:lang w:eastAsia (BCP-47): runs without their own value inherit it */
  eastAsiaLang?: string | undefined;
  /** ignore spacing next to same-style paras (w:contextualSpacing); false = explicit off overriding the style */
  contextualSpacing?: boolean | undefined;
  /** paragraph shading fill, hex without '#' (w:shd w:fill) */
  shadingFill?: string | undefined;
  /** display-only blend for pattern shading (w:shd pctNN/stripes over the fill):
   *  drives the rendered background; never written back — the raw w:shd
   *  round-trips through shadingFill */
  shadingDisplay?: string | undefined;
  /** paragraph borders, subset of "tblr" e.g. "b" or "tblr" (w:pBdr, single lines) */
  borders?: string | undefined;
  /**
   * style details for the `borders` sides: hex color (no '#', default auto),
   * thickness in eighth-points (default 4 = 0.5pt), gap to the text in points
   * (w:space, Word clamps to 0–31, default 1)
   */
  borderStyle?:
    | { color?: string | undefined; szEighths?: number | undefined; spacePt?: number | undefined }
    | undefined;
  /** per-side color/width of `borders` (w:color / w:sz); side absent = auto color, default width */
  borderLines?: Partial<Record<'t' | 'b' | 'l' | 'r', ParaBorderLine>> | undefined;
  /** sides the direct w:pBdr resets (none/nil), subset of "tblr": display-only, cancels the style's side */
  borderReset?: string | undefined;
  /** custom tab stops from w:tabs (non-empty overrides default 0.5in grid) */
  tabStops?: TabStop[] | undefined;
  /** first-line drop cap (w:framePr w:dropCap="drop|margin") */
  dropCap?: { type: 'drop' | 'margin'; lines: number } | undefined;
  /**
   * positioned paragraph frame (w:framePr, P19 canvas pages): the paragraph
   * leaves the text flow and renders at an absolute position. Takes
   * precedence over dropCap (both target the single w:framePr element).
   */
  frame?: ParaFrame | undefined;
  /**
   * RTL paragraph (w:bidi). align stores the visual value: per Word's quirk,
   * w:jc left/right swap meaning in bidi paragraphs; parsing converts to the
   * visual direction and writing back converts again.
   */
  bidi?: boolean | undefined;
  /**
   * w:sz (half-points) governing a run-less paragraph's line height: the
   * paragraph-mark rPr, else the last (dropped) empty run's rPr. Set only when
   * the paragraph has no runs, so empty lines keep their Word height.
   */
  emptyRunSizeHalfPoints?: number | undefined;
  /**
   * w:rFonts (ascii/hAnsi/eastAsia) from the same sources: the empty line lays
   * out with this face's metrics. Read-only for fidelity — generate leaves the
   * paragraph-mark rPr bytes untouched unless the size changed.
   */
  emptyRunFontFamily?: string | undefined;
}

/**
 * Document grid (w:docGrid) — a key property for Chinese documents.
 * With type=lines, each line's height is rounded up to align with linePitch (twips).
 */
export interface DocGrid {
  /** w:type: 'default'|'lines'|'linesAndChars'|'snapToChars', default 'default' */
  type: 'default' | 'lines' | 'linesAndChars' | 'snapToChars';
  /** line pitch (twips, w:linePitch); effective for lines/linesAndChars */
  linePitch?: number | undefined;
  /** characters per line (derived from w:charSpace; effective for linesAndChars/snapToChars) */
  charSpace?: number | undefined;
}

/** Page setup stored in the trailing w:sectPr. All lengths in twips. */
export interface SectionSettings {
  pageWidth: number;
  pageHeight: number;
  orientation: 'portrait' | 'landscape';
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  /** simple single-line box page border (w:pgBorders) */
  pageBorder: boolean;
  /** page border box details (parse-side; pageBorder stays the on/off flag) */
  pageBorderProps?:
    | {
        /** pages the border applies to (w:display); undefined = all pages */
        display?: ('firstPage' | 'notFirstPage') | undefined;
        /** distance basis (w:offsetFrom): 'page' = space from the page edge, 'text' = from the text area */
        offsetFrom?: ('page' | 'text') | undefined;
        /** border distance in points (max across sides' w:space) */
        spacePt: number;
        /** line width in points (max across sides' w:sz eighth-points) */
        widthPt: number;
        /** hex without '#', first side declaring a literal color */
        color?: string | undefined;
        /** per-side lines; a missing side draws no border */
        sides?:
          | Partial<
              Record<
                'top' | 'right' | 'bottom' | 'left',
                {
                  /** OOXML line style (w:val: single, double, thinThickSmallGap, …) */
                  val: string;
                  /** line width in points (w:sz eighth-points / 8) */
                  widthPt: number;
                  /** border distance in points (w:space) */
                  spacePt: number;
                  /** hex without '#' */
                  color?: string | undefined;
                }
              >
            >
          | undefined;
      }
    | undefined;
  /** number of text columns (w:cols w:num), 1 = normal */
  columns: number;
  /** column gap (w:cols w:space, twips; OOXML default 720) */
  colSpace?: number | undefined;
  /**
   * explicit unequal column widths (w:cols w:equalWidth="0" > w:col w:w),
   * twips, layout order; length must equal `columns`. Absent = equal columns.
   * applySectionSettings only rebuilds w:cols children when this is provided.
   */
  colWidths?: number[] | undefined;
  /**
   * section base direction (sectPr w:bidi): Word fills columns right-to-left.
   * undefined = leave the document's tag untouched (round-trip safe).
   */
  bidi?: boolean | undefined;
  /** Header distance from the page top (w:pgMar w:header, twips; default 720). A tall header pushes the body down */
  headerDist?: number | undefined;
  /** Footer distance from the page bottom (w:pgMar w:footer, twips; default 720). A tall footer pushes the body up */
  footerDist?: number | undefined;
  /** Vertical alignment of page content (sectPr w:vAlign): center/both/bottom; default top */
  vAlign?: ('top' | 'center' | 'both' | 'bottom') | undefined;
  /** line grid (w:docGrid), key for Chinese official documents; affects line-height rounding */
  docGrid?: DocGrid | undefined;
  /** text flow direction (sectPr w:textDirection), e.g. tbRl = vertical CJK; absent = horizontal lrTb */
  textDirection?: string | undefined;
}

/** One section: settings + start type + block ownership + header/footer refs (read-only enumeration; editing still goes through sectPr XML) */
export interface SectionInfo {
  settings: SectionSettings;
  /** Section-break type w:type (how this section starts; meaningless for the first section), default nextPage */
  startType: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn';
  /** docxIndex range of this section's blocks (inclusive; the section-break paragraph / trailing hidden sectPr block belong to this section) */
  firstBlockIndex: number;
  lastBlockIndex: number;
  /** raw sectPr XML fragment of this section */
  sectPrXml: string;
  /** different first page for this section (w:titlePg) */
  titlePg: boolean;
  /** page renumbering start value (w:pgNumType w:start); absent = continue from the previous section */
  pageNumberStart?: number | undefined;
  /** page number format (w:pgNumType w:fmt): decimal/lowerRoman/upperLetter/... */
  pageNumberFmt?: string | undefined;
  /** header/footer reference rIds, by variant */
  headerRefs: Partial<Record<'default' | 'first' | 'even', string>>;
  footerRefs: Partial<Record<'default' | 'first' | 'even', string>>;
}

/** one rich paragraph of a header / footer part */
export interface HfParagraph extends ParaFormat {
  /** w:framePr w:xAlign — text frame floated at the margin edge; the line
   *  overlays the following paragraph's flow line instead of stacking (Word) */
  frameXAlign?: ('left' | 'center' | 'right') | undefined;
  /** surfaced content of a floating textbox (wp:anchor / absolute VML shape):
   *  drawn at the anchor in Word, so it adds no strip flow height */
  boxAnchored?: boolean | undefined;
  /** that textbox's placement; the strip draws the paragraph inside a box at
   *  the anchor position instead of stacking it (absent: stacked) */
  box?: HfTextBox | undefined;
  /** w:ptab alignments indexed by overall tab order (regular w:tab slots are undefined); margin-relative, ignores tab stops */
  ptabAligns?: Array<'left' | 'center' | 'right' | undefined> | undefined;
  runs: Run[];
  /** layout-table row: one entry per cell, rendered as columns. Display-only —
   *  saving keeps the part's original w:tbl bytes and never serializes cells. */
  cells?: HfTableCell[] | undefined;
  /** geometry of the layout-table row the cells belong to */
  row?: HfTableRow | undefined;
}

/** display geometry of a header/footer layout-table row */
export interface HfTableRow {
  /** w:trHeight (twips) */
  heightTwips?: number | undefined;
  /** w:trHeight w:hRule (absent = atLeast) */
  heightRule?: ('atLeast' | 'exact') | undefined;
  /** left edge of the table from the strip edge (twips): w:tblInd, which legacy
   *  layout (compatibilityMode < 15) measures to the cell text, so the border
   *  sits one left cell margin further out */
  indentTwips?: number | undefined;
  /** text after a tab that runs past the cell edge: Word 2013+ wraps it onto
   *  the next line, legacy layout leaves it beyond the edge (clipped) */
  tabOverflow?: ('wrap' | 'clip') | undefined;
  /** w:bidiVisual: cells run right to left */
  bidiVisual?: boolean | undefined;
}

/** display props of one paragraph inside a layout-table cell */
export type HfCellParaProps = Pick<
  ParaFormat,
  'align' | 'indentLeft' | 'indentFirstLine' | 'tabStops' | 'spaceBefore' | 'spaceAfter'
>;

/** floating textbox holding header/footer paragraphs; placement fields mirror
 *  HfImage. Consecutive HfParagraph entries with the same id share one box. */
export interface HfTextBox extends Pick<
  HfImage,
  | 'widthPx'
  | 'heightPx'
  | 'behind'
  | 'posH'
  | 'posV'
  | 'posXPx'
  | 'posYPx'
  | 'posHRel'
  | 'posVRel'
  | 'wrap'
> {
  id: number;
  /** wps:bodyPr / v:textbox text insets (px): left, top, right, bottom; absent = Word's 0.1in / 0.05in */
  insets?: [number, number, number, number] | undefined;
  /** wps:bodyPr anchor: vertical placement of the text inside the box */
  vAlign?: ('top' | 'center' | 'bottom') | undefined;
  /** wps:bodyPr wrap="none": a single line that grows the box instead of wrapping */
  nowrap?: boolean | undefined;
  /** a:spAutoFit / mso-fit-shape-to-text: the box grows with its text; without it
   *  Word keeps the declared size and clips the overflow */
  autofit?: boolean | undefined;
  /** index (in the part's paras) of the paragraph the box shares with other
   *  runs; paragraph-relative offsets measure from that paragraph's top */
  anchorPara?: number | undefined;
}

/** one cell of a header/footer layout-table row */
export interface HfTableCell {
  /** cell paragraphs, each rendered as its own block line (Word stacks them) */
  paras: Run[][];
  /** per-paragraph props aligned with paras (undefined = plain) */
  paraProps?: Array<HfCellParaProps | undefined> | undefined;
  align?: ParaAlign | undefined;
  /** column width as % of the row (w:tcW, falling back to tblGrid) */
  widthPct?: number | undefined;
  /** declared column width (w:tcW dxa / spanned tblGrid columns), twips */
  widthTwips?: number | undefined;
  /** cell shading fill (w:tcPr w:shd w:fill hex, non-auto) */
  fill?: string | undefined;
  /** resolved borders: w:tcBorders over the table's edge/inside lines, each
   *  shared line assigned to one cell (right/bottom of the earlier cell) */
  borders?: CellBorders | undefined;
  vAlign?: ('top' | 'center' | 'bottom') | undefined;
  /** cell margins (twips): w:tcMar over w:tblCellMar; absent sides use Word's
   *  defaults (0 top/bottom, 108 left/right) */
  marTwips?: CellMargins | undefined;
}

/** one w:lvl of a numbering definition */
export interface NumberingLevel {
  /** w:numFmt, e.g. "decimal" | "bullet" | "lowerLetter" | "upperRoman" | "chineseCountingThousand" */
  numFmt: string;
  /** w14 custom numFmt enumeration (numFmt "custom"), e.g. "α, β, γ, ..." */
  customFormat?: string | undefined;
  /** w:lvlText, e.g. "%1." or "%1.%2" (placeholders %n = counter of level n-1) or a bullet glyph */
  lvlText: string;
  /** w:start, default 1 */
  start: number;
  /** w:suff — what follows the marker (Word default: tab up to the hanging edge) */
  suff?: ('tab' | 'space' | 'nothing') | undefined;
  /** w:pPr/w:ind left (twips); fallback geometry for items without their own w:ind */
  indentLeft?: number | undefined;
  /** w:pPr/w:ind hanging (twips): width reserved for the number/bullet marker */
  hanging?: number | undefined;
  /** w:pPr/w:ind positive firstLine (twips): the marker starts right of the text indent */
  firstLine?: number | undefined;
  /** w:rPr/w:sz of the marker itself (half-points) */
  szHalfPoints?: number | undefined;
  /** w:rPr/w:rFonts of the marker (bullet glyphs in Symbol/Wingdings need decoding) */
  font?: string | undefined;
}

/** one w:num entry from word/numbering.xml (abstractNum levels + overrides applied) */
export interface NumberingDef {
  numId: string;
  /** counters continue across w:num entries sharing an abstractNum */
  abstractNumId: string;
  /** ilvl -> level definition */
  levels: Record<number, NumberingLevel>;
  /** ilvl -> w:lvlOverride/w:startOverride value (restart markers) */
  startOverrides: Record<number, number>;
}

/** Content for the default page header / footer. */
export interface HeaderFooter {
  text: string;
  /** append an automatic page number (PAGE field), footer only */
  pageNumber?: boolean | undefined;
  /**
   * Rich paragraphs; when present they are the content source of truth and
   * the part regenerates one w:p per entry (PAGE_MARK \u2014 or a user-typed '#'
   * when no PAGE_MARK exists \u2014 becomes the PAGE field when pageNumber is
   * set). Absent = legacy single centered line.
   */
  paras?: HfParagraph[] | undefined;
}

/** Placeholder for NUMPAGES (total pages) fields in headers/footers; the renderer substitutes the total page count and saving writes the field back (PAGE uses PAGE_MARK the same way) */
export const TOTAL_PAGES_MARK = '\uE000';
/** Placeholder for PAGE fields in headers/footers; a private-use character so literal '#' text in the part can never be mistaken for the field position */
export const PAGE_MARK = '\uE001';

/** display-only image in a header/footer part (logos etc.; saving preserves the part's bytes) */
export interface HfImage {
  dataUrl: string;
  widthPx?: number | undefined;
  heightPx?: number | undefined;
  /** wp:anchor floating / VML position:absolute (otherwise inline) */
  floating?: boolean | undefined;
  /** behind body text (negative VML z-index / wp:anchor behindDoc): picture watermarks */
  behind?: boolean | undefined;
  /** VML mso-position-horizontal / wp:positionH wp:align */
  posH?: ('left' | 'center' | 'right') | undefined;
  /** VML mso-position-vertical / wp:positionV wp:align */
  posV?: ('top' | 'center' | 'bottom') | undefined;
  /** wp:positionH wp:posOffset (px); origin per posHRel */
  posXPx?: number | undefined;
  /** wp:positionV wp:posOffset (px); origin per posVRel */
  posYPx?: number | undefined;
  /** wp:positionH relativeFrom: offsets measure from the page edge or the margin box */
  posHRel?: ('page' | 'margin') | undefined;
  /** wp:positionV relativeFrom ('paragraph' also covers 'line'; placement treats it like 'margin') */
  posVRel?: ('page' | 'margin' | 'paragraph') | undefined;
  /** wp:anchor wrap mode; square/tight/through/topBottom header images push the body below them */
  wrap?: ('none' | 'square' | 'tight' | 'through' | 'topBottom') | undefined;
  /** v:imagedata gain/blacklevel present (Word watermark washout preset) */
  washout?: boolean | undefined;
  /** w:jc of the containing paragraph (inline images follow paragraph alignment) */
  align?: ('left' | 'center' | 'right') | undefined;
  /** source crop (a:srcRect) as fractions of the source picture (display-only) */
  crop?: { l: number; t: number; r: number; b: number } | undefined;
}

/** Parsed content of one header/footer part (any w:type variant). */
export interface HfPartInfo {
  /** plain text, PAGE fields shown as PAGE_MARK, NUMPAGES as TOTAL_PAGES_MARK */
  text: string;
  hasPageNumber: boolean;
  paras: HfParagraph[];
  /** images in the part (display-only; text edits do not affect their bytes) */
  images?: HfImage[] | undefined;
}

/** One display run of footnote/endnote body text (for page-bottom rendering; editing still uses plain text) */
export interface NoteRun {
  text: string;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  underline?: boolean | undefined;
  strike?: boolean | undefined;
  /** hex without '#' */
  color?: string | undefined;
  sizeHalfPoints?: number | undefined;
  /** Latin font (direct w:ascii, else w:hAnsi) */
  fontAscii?: string | undefined;
  /** East-Asian font (w:eastAsia) — save-side only, parse does not recover it */
  font?: string | undefined;
  /** w:caps ('all') / w:smallCaps ('small') display transform, 'none' = explicit off */
  caps?: ('all' | 'small' | 'none') | undefined;
}

/** One footnote or endnote (display/edit model; separators are preserved separately). */
export interface NoteInfo {
  /** original w:id, unique within its part */
  id: string;
  /** plain text, paragraphs joined with \n */
  text: string;
  /** rich display runs (one group per paragraph); gone when an edit rebuilds the note as plain text */
  richParas?: NoteRun[][] | undefined;
  /** no w:footnoteRef/w:endnoteRef run in the note body: Word renders the entry without a number mark */
  noRefMark?: true | undefined;
  /** w:pStyle of the first note paragraph (notes without one render with Normal metrics) */
  styleId?: string | undefined;
  /** direct w:spacing of the first note paragraph (overrides the style chain) */
  spacing?:
    | {
        beforeTwips?: number | undefined;
        afterTwips?: number | undefined;
        lineRule?: ('auto' | 'atLeast' | 'exact') | undefined;
        lineRawTwips?: number | undefined;
      }
    | undefined;
}

/** display-only run of a field result: the Run subset the passthrough renderer paints */
export type FieldRun = Pick<
  Run,
  | 'text'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'color'
  | 'sizeHalfPoints'
  | 'font'
  | 'fontAscii'
  | 'csFont'
  | 'link'
>;

/** Display/edit model for a protected field paragraph. */
export interface FieldDisplay {
  /** tocLine: "text .... page"; text: plain visible result; pageBreak: invisible marker */
  kind: 'tocLine' | 'text' | 'pageBreak';
  /** visible text (tocLine: entry title; text: whole result) */
  left?: string | undefined;
  /** page number for tocLine */
  right?: string | undefined;
  /** TOC outline level 1-9 */
  level?: number | undefined;
  /** bookmark anchor of the tocLine hyperlink (_Toc...), for click-to-jump */
  anchor?: string | undefined;
  /** tocLine whose whole result is a tracked deletion (left/right hold the deleted text) */
  deleted?: boolean | undefined;
  /** the deleted tocLine's paragraph mark is deleted too: Word's markup view shows no line at all */
  markDeleted?: boolean | undefined;
  /** numbering marker of the entry's w:numPr ("1.", "1.1."), computed at parse time */
  num?: string | undefined;
  /** display-only metrics of the entry paragraph (direct pPr/run values; Word
   *  sizes TOC lines by them while the style carries nothing) */
  szHalfPoints?: number | undefined;
  /** face of the visible result runs (text fields: dominant; tocLine: leading run): drives the line factor */
  fontFamily?: string | undefined;
  /** tocLine whose leading result run is bold */
  bold?: boolean | undefined;
  /** formatted result runs of a text field (italic journal names, a manual
   *  drop-cap letter next to body text); their joined text equals `left` */
  runs?: FieldRun[] | undefined;
  /** explicit paragraph alignment (text fields): overrides the doc default */
  align?: ('left' | 'center' | 'right' | 'justify') | undefined;
  lineRule?: ('auto' | 'atLeast' | 'exact') | undefined;
  lineRawTwips?: number | undefined;
  lineSpacing?: number | undefined;
}

/** Editable text tokens inside an OMML formula; the surrounding math tree is preserved. */
export interface FormulaDisplay {
  tokens: string[];
  /** MathML Core markup for native 2D rendering (absent = flat token fallback) */
  mathml?: string | undefined;
  /** the paragraph's <m:oMath> fragments, so token edits can re-derive mathml */
  omml?: string | undefined;
  /** LaTeX source recovered by ommlToLatex; enables full re-editing (absent = token edits only) */
  latex?: string | undefined;
}

/** One data series of an embedded chart, read from the cached values in its chart part. */
export interface ChartSeries {
  name?: string | undefined;
  /** cached numeric values by category position; null = gap in the cache */
  values: (number | null)[];
  /** explicit series fill (c:ser/c:spPr solid fill), hex without '#' */
  color?: string | undefined;
  /** explicit per-point fills (c:dPt), e.g. pie slice colors; sparse by point index */
  pointColors?: (string | null)[] | undefined;
  /** scatter/bubble: numeric x of each point (c:xVal) */
  xValues?: (number | null)[] | undefined;
  /** bubble: point sizes (c:bubbleSize) */
  sizes?: (number | null)[] | undefined;
  /** scatter: connect the points (c:scatterStyle line*, unless the series line is a:noFill) */
  line?: boolean | undefined;
}

/**
 * Display/edit model of an embedded chart, extracted from its chart part
 * (word/charts/chartN.xml). Edits patch only cached texts/numbers in that
 * part; the chart structure stays untouched. The embedded workbook is NOT
 * updated, so Word's "Edit Data" sheet will still show the pre-edit numbers.
 */
export interface ChartDisplay {
  /** zip path of the chart part this model was read from */
  partPath: string;
  kind: 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'bubble' | 'other';
  /** bar charts: c:barDir="bar" (horizontal bars); default is column direction */
  horizontal?: boolean | undefined;
  /** c:grouping: series stack per category (percentStacked normalizes each category to 100%) */
  grouping?: ('stacked' | 'percentStacked') | undefined;
  /** line charts: draw point markers (c:marker) */
  markers?: boolean | undefined;
  /** doughnut hole as % of the radius (c:holeSize); absent = solid pie */
  holePct?: number | undefined;
  /** legend position (c:legend/c:legendPos); absent = no c:legend element */
  legendPos?: ('b' | 'l' | 'r' | 't' | 'tr') | undefined;
  /** chart title; undefined when the chart has no title part (then not editable) */
  title?: string | undefined;
  categories: string[];
  series: ChartSeries[];
  /** series color cycle from the chart style + theme accents (hex, no '#'); absent = Office default */
  palette?: string[] | undefined;
  /** display size (from wp:extent), editable via the corner resize handle */
  widthPx?: number | undefined;
  heightPx?: number | undefined;
}

/** One SmartArt shape from the precomputed diagram drawing part (dsp:sp), in px */
export interface DiagramShape {
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
  /** a:prstGeom preset (roundRect/ellipse/...); rendering approximates by radius */
  prst?: string | undefined;
  /** solid fill (hex without '#') */
  fillHex?: string | undefined;
  /** a:ln stroke color (hex without '#'); connectors (prst=line, zero cx/cy) render as rules */
  lnHex?: string | undefined;
  /** a:ln stroke width in px */
  lnWPx?: number | undefined;
  /** picture fill (a:blipFill) */
  imageDataUrl?: string | undefined;
  /** a:stretch/a:fillRect fractions of the picture fill (negative = bleed) */
  fillRect?: { l: number; t: number; r: number; b: number } | undefined;
  /** paragraph texts of the shape's txBody */
  texts?: string[] | undefined;
  fontSizePt?: number | undefined;
  textColorHex?: string | undefined;
  /** rotation in degrees (a:xfrm rot / 60000) */
  rotDeg?: number | undefined;
}

/** SmartArt display-only degrade from diagrams/drawingN.xml (Word's resolved layout) */
export interface DiagramDisplay {
  widthPx: number;
  heightPx: number;
  shapes: DiagramShape[];
  /** anchored-drawing offset of the diagram's own wp:anchor (EMU) */
  offsetXEmu?: number | undefined;
  offsetYEmu?: number | undefined;
  /** wrapNone/behind/front anchor (or sharing a paragraph with other drawings): leaves the flow like Word */
  floating?: boolean | undefined;
  /** drawing-canvas display (lockedCanvas): text renders at its raw font size
   *  and overflows the scaled child geometry instead of clipping (LO behavior) */
  canvas?: boolean | undefined;
}

/** A new chart to embed at save time (becomes word/charts/chartN.xml + relationship). */
export interface NewChart {
  kind: 'bar' | 'line' | 'pie';
  title?: string | undefined;
  categories: string[];
  series: Array<{ name: string; values: (number | null)[] }>;
}

/** Editable interchange model of one table cell (type === 'table' blocks). */
export interface TableParagraph extends ParaFormat {
  runs: Run[];
  /** w:pStyle of the cell paragraph (style CSS: fonts/spacing reach cell content) */
  styleId?: string | undefined;
  /** list paragraph inside the cell (w:numPr) */
  list?: { kind: 'bullet' | 'ordered'; numId: string; ilvl: number } | undefined;
}

/** One cell border (a w:tcBorders child element) */
export interface CellBorder {
  /** w:val, e.g. single/dashed/double; 'none' means explicitly no border */
  style: string;
  /** w:sz, in 1/8 pt units */
  szEighths?: number | undefined;
  /** hex without '#', or 'auto' */
  color?: string | undefined;
}

export interface CellBorders {
  top?: CellBorder | undefined;
  left?: CellBorder | undefined;
  bottom?: CellBorder | undefined;
  right?: CellBorder | undefined;
}

/** Table-level borders (w:tblBorders), including inner horizontal/vertical lines */
export interface TableBorders extends CellBorders {
  insideH?: CellBorder | undefined;
  insideV?: CellBorder | undefined;
}

/** Cell margins (twips); unspecified sides inherit the table-level/Word defaults (0 top/bottom, 108 left/right) */
export interface CellMargins {
  top?: number | undefined;
  left?: number | undefined;
  bottom?: number | undefined;
  right?: number | undefined;
}

export interface TableCell {
  /** paragraph texts inside the cell */
  paras: string[];
  /** rich paragraph content; when present this is the formatting source of truth */
  richParas?: TableParagraph[] | undefined;
  /** this cell's margin overrides (w:tcMar) */
  cellMarTwips?: CellMargins | undefined;
  /** nested tables inside this cell (shown as read-only sub-tables; bytes kept faithful by the outer table) */
  nestedTables?: TableModel[] | undefined;
  /** anchored shapes/textboxes inside cell paragraphs (display-only; Word grows the row to hold them) */
  anchoredBoxes?: TextboxDisplay[] | undefined;
  /** per anchored box: index of its anchor paragraph (positionV "paragraph" origin); absent = cell top */
  anchoredBoxAnchors?: number[] | undefined;
  /** per nested table: how many cell paragraphs precede it (reading-order anchor); absent = after all paragraphs */
  nestedTableAnchors?: number[] | undefined;
  colSpan?: number | undefined;
  /** display-only placeholder spanning a row's w:gridBefore/w:gridAfter columns (no borders/fill, not written back as w:tc) */
  gridGap?: boolean | undefined;
  /** 'restart' opens a vertical merge, 'continue' is a merged-away cell */
  vMerge?: ('restart' | 'continue') | undefined;
  /** cell shading fill, hex without '#' (w:shd w:fill) */
  fill?: string | undefined;
  /** first-run text color, hex without '#' */
  color?: string | undefined;
  bold?: boolean | undefined;
  align?: ParaAlign | undefined;
  /** vertical alignment (w:vAlign): top (default)/center/bottom */
  vAlign?: ('top' | 'center' | 'bottom') | undefined;
  /** vertical text (w:textDirection): tbRl = vertical right-to-left, btLr = horizontal rotated 90° (bottom-up) */
  textDirection?: ('tbRl' | 'btLr') | undefined;
  /** legacy horizontal merge (w:hMerge, intermediate parse state): continue cells fold into the restart cell to their left */
  hMerge?: ('restart' | 'continue') | undefined;
  /** cell borders (w:tcBorders); undefined = no tcBorders (table-level/style borders apply) */
  borders?: CellBorders | undefined;
  /** raw <w:tcPr>…</w:tcPr> bytes: surgically patched on regeneration so unmodeled
   *  properties (tcMar/textDirection etc.) are not lost */
  rawTcPr?: string | undefined;
  /** cell-level revision (tcPr w:cellIns / w:cellDel) */
  cellRevision?: ({ kind: 'ins' | 'del' } & RevisionInfo) | undefined;
}

export type TableAutoFitMode = 'contents' | 'window' | 'fixed';

/** Word's Table Style Options (w:tblLook). */
export interface TableLook {
  firstRow: boolean;
  lastRow: boolean;
  firstColumn: boolean;
  lastColumn: boolean;
  bandedRows: boolean;
  bandedColumns: boolean;
}

/** Editable interchange model of a table block, extracted from or generated to OOXML. */
export interface TableModel {
  rows: TableCell[][];
  /** relative column widths in percent (from w:tblGrid) */
  colWidthsPct?: number[] | undefined;
  /** absolute column widths in twips (w:tblGrid); only when every gridCol > 0 */
  colWidthsTwips?: number[] | undefined;
  /** table width as a percentage of the body width (w:tblW type="pct"); absolute widths are ignored when set */
  widthPct?: number | undefined;
  /** autofit layout (no fixed w:tblLayout; w:tblW auto/absent/zero or pct): display may widen columns to min-content */
  autoLayout?: boolean | undefined;
  /** editable Word AutoFit mode (w:tblLayout + w:tblW) */
  autoFit?: TableAutoFitMode | undefined;
  /** literal w:tblLayout type="fixed": Word keeps the declared column widths even when the
   * table runs past the paper edge (content clips there), so display must never narrow them */
  fixedLayout?: boolean | undefined;
  /** table-level default cell margins (w:tblCellMar) */
  cellMarTwips?: CellMargins | undefined;
  /** w:tblCellSpacing (twips, half the gap between adjacent cells); cells render boxed with gaps */
  cellSpacingTwips?: number | undefined;
  /** table shading (tblPr w:shd), hex without '#'; shows through transparent cells and cell-spacing gaps */
  fill?: string | undefined;
  /** table-level borders (w:tblBorders); undefined = not declared (default gridlines apply) */
  borders?: TableBorders | undefined;
  /** table horizontal alignment (tblPr w:jc); default left */
  align?: ('left' | 'center' | 'right') | undefined;
  /** table left indent (w:tblInd, twips; effective only with left alignment) */
  indentTwips?: number | undefined;
  /**
   * absolutely positioned floating table (w:tblpPr + w:tblOverlap, P19 canvas
   * pages): x/y in twips from the anchors' top-left (page anchors by
   * default). Only applies when the tblPr is built fresh (generated tables).
   */
  floatPos?:
    | {
        xTwips: number;
        yTwips: number;
        horzAnchor?: ('page' | 'margin' | 'text') | undefined;
        vertAnchor?: ('page' | 'margin' | 'text') | undefined;
        /** gap between the floating table and surrounding text (w:*FromText) */
        distanceTwips?: CellMargins | undefined;
      }
    | undefined;
  /** floating table (w:tblpPr): text wraps around the side opposite the anchor */
  floatSide?: ('left' | 'right' | null) | undefined;
  /** per-row height (twips, w:trHeight; null = not set), aligned with rows */
  rowHeightsTwips?: Array<number | null> | undefined;
  /** per-row height rule (w:trHeight w:hRule; absent/legacy models = atLeast), aligned with rows */
  rowHeightRules?: Array<'atLeast' | 'exact' | null> | undefined;
  /** per-row repeat-as-header flag (w:trPr/w:tblHeader), aligned with rows */
  repeatHeaderRows?: Array<boolean | null> | undefined;
  /** per-row raw <w:trPr>…</w:trPr> bytes (passed through verbatim), aligned with rows */
  rawTrPrs?: Array<string | null> | undefined;
  /** row-level revisions (trPr w:ins/w:del = inserted/deleted row), aligned with rows */
  rowRevisions?: Array<({ kind: 'ins' | 'del' } & RevisionInfo) | null> | undefined;
  /** table style reference (w:tblStyle w:val); '' = explicitly no style, undefined = leave as-is */
  tblStyleId?: string | undefined;
  /** conditional table-style switches (w:tblLook) */
  tableLook?: TableLook | undefined;
  /** RTL table (tblPr w:bidiVisual): columns display right to left */
  bidiVisual?: boolean | undefined;
}

/**
 * One ink annotation (freehand strokes) to write at save time. Becomes a floating
 * anchored picture (wp:anchor, in front of text) inside its anchor paragraph;
 * word/media/... + relationship are created like NewImage.
 */
export interface NewInkImage {
  /** index into the finalBlocks array of the anchor block */
  blockIndex: number;
  /** transparent PNG bytes, base64 encoded */
  base64: string;
  widthPx: number;
  heightPx: number;
  /** offset from the text column's left edge (may be negative) */
  offsetXPx: number;
  /** offset from the top of the anchor paragraph (may be negative) */
  offsetYPx: number;
  /** opaque editor payload stored in wp:docPr descr (stroke vectors) */
  payload?: string | undefined;
}

/** One ink annotation read back from a document (display/restore model). */
export interface InkInfo {
  /** docxIndex of the paragraph carrying the anchored drawing */
  anchorIndex: number;
  offsetXPx: number;
  offsetYPx: number;
  widthPx: number;
  heightPx: number;
  /** embedded PNG as data URL; null when the media part is unreadable */
  dataUrl: string | null;
  /** editor stroke payload from wp:docPr descr; null when absent */
  payload: string | null;
}

/**
 * Text wrapping of a floating image (wp:anchor):
 * square-* = square wrap (text flows around, image on left/right), topBottom = top and
 * bottom, behind = behind text, front = in front of text.
 */
/**
 * Wrap modes. tight/through still render approximated as square, but the model keeps
 * them distinct for fidelity: the wrap element is not rebuilt unless the wrap is
 * explicitly changed, and repositioning reuses the original wrapTight/wrapThrough
 * bytes (including wp:wrapPolygon) as a whole.
 */
export type ImageWrap =
  | 'square-left'
  | 'square-right'
  | 'tight-left'
  | 'tight-right'
  | 'through-left'
  | 'through-right'
  | 'topBottom'
  | 'behind'
  | 'front';

/** A new image to embed at save time (becomes word/media/... + relationship). */
export interface NewImage {
  /** raw image bytes, base64 encoded */
  base64: string;
  mime: 'image/png' | 'image/jpeg' | 'image/gif';
  widthPx: number;
  heightPx: number;
  /** paragraph alignment for the image (w:jc) */
  align?: ('left' | 'center' | 'right') | undefined;
  /** floating wrap mode; absent = inline */
  wrap?: ImageWrap | undefined;
  /**
   * numeric anchor position in EMU (only with `wrap`): positionH relative to
   * the column, positionV relative to the anchor paragraph. Absent = the
   * wrap mode's default <wp:align> placement. `relativeTo: 'page'` pins both
   * axes to the page box instead (full-page backgrounds).
   */
  posOffsetEmu?: { x: number; y: number; relativeTo?: 'page' | undefined } | undefined;
  /**
   * stacking rank among anchored drawings (only with `wrap`): written as
   * relativeHeight base + zOrder, so overlapping behindDoc anchors keep a
   * deterministic paint order (higher = in front). Absent = base value.
   */
  zOrder?: number | undefined;
  /**
   * explicit w:spacing on the picture's holder paragraph. Layout-rebuilding
   * writers (pdf2docx) set this so the paragraph does not inherit the
   * template docDefaults (space-after + multiplied line height).
   */
  paraSpacing?:
    | {
        beforeTwips?: number | undefined;
        afterTwips?: number | undefined;
        lineTwips?: number | undefined;
        lineRule?: ('exact' | 'atLeast') | undefined;
      }
    | undefined;
  /** rotation in degrees clockwise (a:xfrm rot) */
  rotDeg?: number | undefined;
  /** mirror flips (a:xfrm flipH/flipV) */
  flipH?: boolean | undefined;
  flipV?: boolean | undefined;
}

export type BlockType = 'paragraph' | 'heading' | 'listItem' | 'table' | 'image' | 'passthrough';

/** direct w:ind of a textbox anchor paragraph (twips; negative firstLine = hanging) */
export interface StrayIndent {
  leftTwips?: number | undefined;
  rightTwips?: number | undefined;
  firstLineTwips?: number | undefined;
}

export interface Block {
  /** stable id for editor bookkeeping */
  id: string;
  type: BlockType;
  /**
   * Index of the top-level element in <w:body> of the ORIGINAL document.xml.
   * This is the patch anchor. null for blocks created in the editor.
   */
  docxIndex: number | null;
  /** exact XML slice from the original document.xml (patch passthrough basis) */
  originalXml: string | null;
  /** heading level 1-9 (type === 'heading') */
  level?: number | undefined;
  /** level comes from a direct w:outlineLvl on a non-heading style: outline/TOC
   * entry only, rendered with body formatting (Word never restyles for outlineLvl) */
  outlineOnly?: boolean | undefined;
  /** original w:pStyle val, if any */
  styleId?: string | undefined;
  /** list info (type === 'listItem') */
  list?: { kind: 'bullet' | 'ordered'; numId: string; ilvl: number } | undefined;
  /** paragraph-level formatting (paragraph / heading / listItem) */
  format?: ParaFormat | undefined;
  /** user bookmarks starting in this paragraph (w:bookmarkStart, _internal names excluded) */
  bookmarks?: string[] | undefined;
  /** Word internal bookmarks (_Ref/_Toc/_Hlk…): hidden from UI, re-emitted on rebuild so REF/TOC anchors survive editing */
  hiddenBookmarks?: string[] | undefined;
  /** Cross-paragraph comment ranges: ids whose start falls in this paragraph only (end is in a later one). Re-emitted at paragraph start on rebuild to avoid orphaned endpoints */
  commentStarts?: string[] | undefined;
  /** Cross-paragraph comment ranges: ids whose end falls in this paragraph only. end+reference are re-emitted at paragraph end on rebuild */
  commentEnds?: string[] | undefined;
  /**
   * Exact original <w:pPr> slice (paragraph / heading / listItem). Regenerated
   * paragraphs reuse it verbatim (text-only edits) or merge format changes
   * into it, so pPr constructs the format model cannot express (keepNext,
   * tabs, paragraph-mark rPr, pPrChange revisions...) survive editing.
   */
  rawPPr?: string | undefined;
  /** rich text content (paragraph / heading / listItem) */
  runs?: Run[] | undefined;
  /** human label for protected blocks (localized strings like "Table 3×4", "Image", "Chart") */
  label?: string | undefined;
  /** plain-text preview for protected blocks */
  previewText?: string | undefined;
  /** data URL for inline display (type === 'image', or the packaged OLE preview on passthrough) */
  imageDataUrl?: string | undefined;
  /** OLE embed ProgID (o:OLEObject), e.g. "Excel.Sheet.12"; drives the friendly type caption */
  oleProgId?: string | undefined;
  /** display size from wp:extent in CSS px (type === 'image') */
  imageWidthPx?: number | undefined;
  imageHeightPx?: number | undefined;
  /** source crop (a:srcRect) as fractions of the source picture (display-only) */
  imageCrop?: { l: number; t: number; r: number; b: number } | undefined;
  /** fill placement (a:stretch/a:fillRect) as fractions of the shape box; negative = bleed (display-only) */
  imageFillRect?: { l: number; t: number; r: number; b: number } | undefined;
  /** Preserved whitespace before an inline picture and its paragraph indents (display-only). */
  imageLeadingText?: string | undefined;
  imageLeadingFont?: string | undefined;
  imageLeadingExplicitSpaceWidthPx?: number | undefined;
  imageLeadingImplicitSpaceCount?: number | undefined;
  imageParagraphIndentLeft?: number | undefined;
  imageParagraphIndentRight?: number | undefined;
  imageParagraphIndentFirstLine?: number | undefined;
  /** the block's paragraph keeps its own empty line in Word (sized by the
   *  paragraph mark): side-wrapped anchored pictures, invisible VML picts */
  anchorLine?: { styleId?: string | undefined; format?: ParaFormat | undefined } | undefined;
  /** paragraph alignment of the image (w:jc) */
  imageAlign?: ('left' | 'center' | 'right') | undefined;
  /** text wrapping of a floating image (wp:anchor); absent = inline (in line with text) */
  imageWrap?: ImageWrap | undefined;
  /** side-wrapped picture that no text fits beside (a floating table takes the
   *  rest of the column): render as a band at its offset instead of a CSS float */
  imageBand?: boolean | undefined;
  /** wp:anchor text-wrap distances (EMU; display-only) */
  imageWrapDistTopEmu?: number | undefined;
  imageWrapDistBottomEmu?: number | undefined;
  imageWrapDistLeftEmu?: number | undefined;
  imageWrapDistRightEmu?: number | undefined;
  /**
   * stacking rank of a floating image among overlapping anchors, decoded from
   * wp:anchor relativeHeight minus the 251658240 base (0 when at/below base).
   * Higher paints in front. Round-trips so opening an untouched doc and saving
   * preserves the original z-order, and the editor's bring-forward/send-back
   * commands write it back. Absent = inline / base level.
   */
  imageZOrder?: number | undefined;
  /**
   * imageZOrder was compressed from a wild producer relativeHeight
   * (LibreOffice writes 1, 2, …). Word paints by the raw value, so once any
   * wrap/z-order edit rewrites one anchor to base+rank encoding, every
   * normalized sibling must be rewritten too or the saved paint order
   * inverts (save-time harmonization; untouched documents keep their bytes).
   */
  imageZOrderNormalized?: boolean | undefined;
  /**
   * Horizontal/vertical posOffset (in EMU) of a floating image (wp:anchor
   * with wp:positionH/V using posOffset, not align). Used for free-position
   * drag. Absent when the image uses named alignment (left/center/right) or
   * is inline.
   */
  imageOffsetXEmu?: number | undefined;
  imageOffsetYEmu?: number | undefined;
  /** wp:anchor locked="1": moving the picture must not change its anchor paragraph */
  imageAnchorLocked?: boolean | undefined;
  /** margin-relative wp:align of a floating image (Word position-gallery presets) */
  imagePosH?: ('left' | 'center' | 'right') | undefined;
  imagePosV?: ('top' | 'center' | 'bottom') | undefined;
  /** picture rotation in degrees clockwise 0-359 (pic a:xfrm rot / 60000) */
  imageRotDeg?: number | undefined;
  /** picture mirror flips (pic a:xfrm flipH/flipV) */
  imageFlipH?: boolean | undefined;
  imageFlipV?: boolean | undefined;
  /** picture outline (pic:spPr a:ln solid fill; display-only, like crop) */
  imageBorder?: { color: string; widthPt: number } | undefined;
  /** editable structure (type === 'table'); untouched original XML still saves byte-identically */
  table?: TableModel | undefined;
  /** display-only rendering for field passthrough paragraphs (TOC lines etc.) */
  fieldDisplay?: FieldDisplay | undefined;
  /** true for body-trailing elements (w:sectPr) that are never shown in the editor */
  hidden?: boolean | undefined;
  /** protected drawing that is just a decorative rule; render as a line, not a chip */
  decorative?: boolean | undefined;
  /** stroke display of a decorative rule (a:ln); absent = default 1px full-width line */
  ruleColorHex?: string | undefined;
  ruleThicknessPx?: number | undefined;
  ruleWidthPx?: number | undefined;
  /** picture whose rel/media is broken (or metafile-only): render an empty frame + alt text */
  brokenImage?: boolean | undefined;
  /**
   * Invisible range marker leaked to body top level (w:bookmarkEnd, w:proofErr…):
   * renders as nothing but keeps its body position. Not `hidden` — hidden blocks
   * are moved to the body tail on save, which would relocate the marker.
   */
  invisibleMarker?: boolean | undefined;
  /** display-only content of anchored textboxes (code boxes, callouts) */
  textboxes?: TextboxDisplay[] | undefined;
  anchorSnapToGrid?: false | undefined;
  /** the anchor paragraph's own text runs next to content textboxes (display-only) */
  strayRuns?: Run[] | undefined;
  /** w:pStyle of the anchor paragraph; styles strayRuns via data-style */
  strayStyleId?: string | undefined;
  /** the anchor paragraph's direct w:ind (display-only, lays out the stray line) */
  strayIndent?: StrayIndent | undefined;
  /** w:jc of the anchor paragraph (direct or style): aligns the stray line */
  strayAlign?: ParaAlign | undefined;
  /** numbering reference of the anchor paragraph: its stray line carries the marker and counts in the list */
  strayList?: { numId: string; ilvl: number } | undefined;
  /** text tokens of an OMML formula, in document order */
  formulaDisplay?: FormulaDisplay | undefined;
  /** display/edit model of an embedded chart (set on chart-labeled blocks) */
  chartDisplay?: ChartDisplay | undefined;
  /** display-only SmartArt degrade from the precomputed diagram drawing part */
  diagramDisplay?: DiagramDisplay | undefined;
  /**
   * When this block was wrapped in a w:sdt (structured document tag), the
   * original sdtPr + shell bytes are stored here for save-time re-wrapping.
   * The block's runs/format are from sdtContent and are fully editable;
   * saving patches only those runs while keeping the sdt shell verbatim.
   */
  sdtShell?: SdtShell | undefined;
  /**
   * Move revision: 'from' = content was moved away (shown with strikethrough + red bg),
   * 'to' = content was moved here (shown with green bg). Accept/reject via del/ins marks.
   */
  moveRevision?: ('from' | 'to') | undefined;
  /**
   * When this paragraph has a tracked paragraph-property change (w:pPrChange),
   * this carries the revision author/date for the review UI badge and navigation.
   * The raw pPrChange XML is preserved in rawPPr and used for accept/reject.
   */
  pPrChangeInfo?:
    | {
        author: string;
        date?: string | undefined;
        id?: string | undefined;
        old?:
          | (ParaFormat & {
              type?: ('docParagraph' | 'docHeading' | 'docListItem') | undefined;
              styleId?: string | undefined;
              level?: number | undefined;
              kind?: ('bullet' | 'ordered') | undefined;
              numId?: string | undefined;
              ilvl?: number | undefined;
            })
          | undefined;
      }
    | undefined;
  /** Top-level block insertion/deletion wrapper (w:ins/w:del around w:p or w:tbl). */
  blockRevision?: ({ kind: 'ins' | 'del' } & RevisionInfo) | undefined;
  /** Tracked deletion of the paragraph mark (w:pPr/w:rPr/w:del): Word joins the paragraph into the next one. */
  paraMarkDel?: { author: string; date?: string | undefined; id?: string | undefined } | undefined;
}

/** numbering marker of a textbox paragraph, resolved at parse time (display only) */
export interface TextboxListMarker {
  text: string;
  /** bullet declared in a symbol-encoded font: drawn with the substitute-glyph styling */
  symbol?: boolean | undefined;
  /** numbering level w:ind left/hanging/firstLine (twips), used when the paragraph has no w:ind of its own */
  indentLeft?: number | undefined;
  hanging?: number | undefined;
  firstLine?: number | undefined;
  /** numbering level w:rPr/w:sz (half-points) */
  szHalfPoints?: number | undefined;
}

/** one paragraph inside an anchored textbox */
export interface TextboxParaDisplay extends ParaFormat {
  /** w:pStyle id, rendered as data-style so the document style CSS applies */
  styleId?: string | undefined;
  runs: Run[];
  listMarker?: TextboxListMarker | undefined;
}

/**
 * Display model of an anchored textbox. Text edits are patched back into the
 * original XML via patchTextboxParas; everything else saves byte-identical.
 */
export interface TextboxDisplay {
  /** hex without '#' */
  fill?: string | undefined;
  /** hex without '#' */
  borderColor?: string | undefined;
  /** box width from wp:extent in CSS px (render fidelity) */
  widthPx?: number | undefined;
  /**
   * fixed box height in CSS px. Only set when the shape's autofit is off,
   * i.e. Word renders the box at this exact height and clips overflow.
   */
  heightPx?: number | undefined;
  /** original fixed height; edited boxes may grow but never shrink below this */
  minHeightPx?: number | undefined;
  /** text body insets from wps:bodyPr, in CSS px */
  insetTopPx?: number | undefined;
  insetRightPx?: number | undefined;
  insetBottomPx?: number | undefined;
  insetLeftPx?: number | undefined;
  /**
   * DrawingML preset geometry name (a:prstGeom prst="...") for shape rendering.
   * Absent for plain rectangular textboxes (rect = default).
   */
  prst?: string | undefined;
  /**
   * a:custGeom outline as normalized SVG path channels (coords 0..1, scaled to
   * the box by the renderer), display-only. Wins over prst when present.
   */
  pathData?:
    | { path?: string | undefined; fillPath?: string | undefined; strokePath?: string | undefined }
    | undefined;
  /**
   * WordArt preset id (e.g. 'wordArt-1').  When set, the editor applies
   * large-text CSS approximation (color + optional text-stroke).
   * This field is display-only; it is never written to OOXML.
   */
  wordArtId?: string | undefined;
  /** text outline of imported VML WordArt (v:textpath strokecolor), display-only */
  textOutline?: { colorHex: string; widthPx: number } | undefined;
  /** single-line content (WordArt strings never wrap) */
  nowrap?: boolean | undefined;
  /** vertical anchoring of the text body (wps:bodyPr anchor="ctr|b"), display-only */
  vAlign?: ('center' | 'bottom') | undefined;
  /** default text color from the shape style's a:fontRef (hex without '#'); a run's own color wins */
  textColor?: string | undefined;
  /**
   * Ordinal of this box's first w:txbxContent among all non-fallback
   * w:txbxContent segments in the block XML. The save path addresses the box
   * by it — positional matching skews whenever a paragraph also renders boxes
   * that consume no segment (ink-only shapes, WordArt, pictures).
   */
  txbxIndex?: number | undefined;
  /**
   * wps:cNvPr id of the owning DrawingML shape. A box with no txbxIndex has
   * no w:txbxContent yet: its first text commit injects a fresh wps:txbx into
   * the shape addressed by this id.
   */
  shapeId?: string | undefined;
  /**
   * Content holds tables / content controls flattened into display lines, so
   * paras do not map 1:1 onto the w:txbxContent w:p children the patch-save
   * path rewrites. The editor must not offer text editing for this box or a
   * commit would corrupt the table (sidebars).
   */
  readOnly?: boolean | undefined;
  paras: TextboxParaDisplay[];
  /** this box's own wp:anchor offset (EMU); with `floating`, the box positions
   *  absolutely at the offset from the paragraph's flow origin */
  offsetXEmu?: number | undefined;
  offsetYEmu?: number | undefined;
  /** wrapNone/behind/front anchors — or any anchored shape sharing its
   *  paragraph with other drawings — leave the flow like Word (absolute
   *  position, no flow height) instead of stacking as blocks */
  floating?: boolean | undefined;
  /** behindDoc="1" anchor: this box paints under the body text */
  behind?: boolean | undefined;
  /** wp:anchor relativeHeight rank (display-only): paint order among overlapping floats */
  z?: number | undefined;
  /** first-page page-anchored cover art: offsets are raw page coordinates and
   *  the box positions against the page box, not the anchor paragraph */
  pagePinned?: boolean | undefined;
  /** page/margin-relative posOffset V rendered from the anchor paragraph: the
   *  canvas re-pins the box to its page top (Word treats the offset as
   *  absolute on the anchor's page, wherever the anchor sits) */
  pageRelV?: boolean | undefined;
  /** `page` keeps its page Y under a header push; `margin` follows the body top (Word) */
  pageRelVFrom?: ('page' | 'margin') | undefined;
  /** page/margin-relative X: absolute on the page in Word — a column-translated
   *  anchor block must not drag the box sideways (the canvas undoes --col-dx) */
  pageRelX?: boolean | undefined;
  /** wrapTopAndBottom (paragraph/line-relative V): the anchor paragraph keeps
   *  flow height down to this box bottom (px) so following text resumes below */
  bandBottomPx?: number | undefined;
  /** wp:inline group child: the drawing's extent height (px). Grouped shapes
   *  place absolutely, so the anchor line reserves this height in flow (Word) */
  inlineExtentPx?: number | undefined;
  /** the band's top edge (px, offset component of bandBottomPx); the renderer
   *  adds the live box height so in-editor autogrow moves the band with it */
  bandTopPx?: number | undefined;
  /** column-spanning wrapSquare band: Word keeps the box on its anchor's page
   *  and lets it overflow the bottom margin instead of pushing it whole */
  bandOverflow?: boolean | undefined;
  /** wrapSquare/Tight/Through anchor: text may flow beside the box, a table cannot */
  wrapSides?: boolean | undefined;
  /** in-column wrapSquare box: the renderer floats it on this side so body
   *  text flows beside it like Word; wrapEdgePx is the box's distance from
   *  that column edge (negative when it protrudes), wrapGapPx the text clearance */
  wrapSide?: ('left' | 'right') | undefined;
  wrapEdgePx?: number | undefined;
  wrapGapPx?: number | undefined;
  /** band reserved only to keep a following table below the box: empty paragraphs
   *  before that table still sit beside the box (inside the band) like Word */
  bandBeside?: boolean | undefined;
  /** rotation in degrees clockwise (a:xfrm rot / 60000) */
  rotDeg?: number | undefined;
  /** border width in CSS px (a:ln w) */
  borderWidthPx?: number | undefined;
  /** dashed/dotted border (a:prstDash) */
  borderDash?: ('dashed' | 'dotted') | undefined;
  /** picture fill (a:blipFill in the shape properties, or a pic:pic photo
   *  sharing a multi-drawing paragraph), as a data URL */
  fillImageDataUrl?: string | undefined;
  /** tile the picture fill (a:tile) instead of stretching it */
  fillTile?: boolean | undefined;
  /** straight connector with a real vertical extent: drawn corner-to-corner
   *  instead of as a level rule (flips pick the diagonal) */
  lineDiag?: boolean | undefined;
  /** a:xfrm flipH/flipV (connector direction) */
  flipH?: boolean | undefined;
  flipV?: boolean | undefined;
}

/** Final body content decided by the editor at save time. */
export type FinalBlock =
  { source: 'original'; docxIndex: number } | { source: 'generated'; block: GeneratedBlock };

/** Content the generator can turn into an OOXML <w:p> fragment. */
export interface GeneratedBlock {
  type: 'paragraph' | 'heading' | 'listItem';
  level?: number | undefined;
  /** heading by direct w:outlineLvl only: write the level, never a Heading style */
  outlineOnly?: boolean | undefined;
  styleId?: string | undefined;
  list?: { kind: 'bullet' | 'ordered'; numId: string; ilvl: number } | undefined;
  format?: ParaFormat | undefined;
  /** emit this exact <w:pPr> instead of rebuilding it (see Block.rawPPr) */
  rawPPr?: string | undefined;
  /** bookmark names to re-emit at the paragraph start (w:bookmarkStart/End pair) */
  bookmarks?: string[] | undefined;
  /** internal (_-prefixed) bookmark names, re-emitted before `bookmarks` */
  hiddenBookmarks?: string[] | undefined;
  /** cross-paragraph comment range starts to re-emit at paragraph start */
  commentStarts?: string[] | undefined;
  /** cross-paragraph comment range ends (+reference) to re-emit at paragraph end */
  commentEnds?: string[] | undefined;
  runs: Run[];
  /**
   * When this block was originally wrapped in a w:sdt, re-wrap the generated
   * paragraph XML with this shell on save (byte-fidelity rule for the sdt structure).
   */
  sdtShell?: SdtShell | undefined;
  /**
   * JSON {author,date?,id?} when the block originally had a pPrChange.
   * Set to null by the editor when the user accepts/rejects the pPrChange revision;
   * applyRawPPr then strips <w:pPrChange> from rawPPr so the saved file is clean.
   */
  pPrChange?: (string | null) | undefined;
  /** Used by editor dirty detection; SaveBlock carries the actual wrapper metadata. */
  blockRevision?: (({ kind: 'ins' | 'del' } & RevisionInfo) | null) | undefined;
}

/** display-only formatting a paragraph style contributes (for on-screen fidelity) */
export interface StyleDisplay {
  sizeHalfPoints?: number | undefined;
  /** w:kern threshold in half-points (0 = explicitly off) */
  kernHalfPoints?: number | undefined;
  /** hex without '#', or 'auto' (explicit w:color auto resetting a basedOn colour) */
  color?: string | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  /** Cs twins (w:bCs/w:iCs/w:szCs): the set rtl runs read instead of bold/italic/
   * sizeHalfPoints (probed, no cross-fallback) — select via styleRunFormat */
  boldCs?: boolean | undefined;
  italicCs?: boolean | undefined;
  sizeCsHalfPoints?: number | undefined;
  /** style rPr w:rtl: inherited rtl for runs without their own flag */
  rtl?: boolean | undefined;
  underline?: boolean | undefined;
  strike?: boolean | undefined;
  font?: string | undefined;
  /** latin-slot font when it differs from the east-asian one (w:ascii/w:hAnsi) */
  fontAscii?: string | undefined;
  /** the EA face is a backfill for an empty theme slot (<a:ea typeface=""/>), not a document choice */
  eaSlotEmpty?: boolean | undefined;
  /** complex-script font (w:rFonts cs/cstheme) */
  csFont?: string | undefined;
  /** character spacing (rPr w:spacing, twips, may be negative) */
  charSpacingTwips?: number | undefined;
  /** style-level pPr w:tabs (Word's built-in Header/Footer styles carry the center/right stops) */
  tabStops?: TabStop[] | undefined;
  /** w:caps ('all') / w:smallCaps ('small') display transform, 'none' = explicit off */
  caps?: ('all' | 'small' | 'none') | undefined;
  /** multiple of single line spacing (w:spacing w:line, lineRule auto) */
  lineSpacing?: number | undefined;
  /** F1: lineRule for accurate height calculation */
  lineRule?: ('auto' | 'atLeast' | 'exact') | undefined;
  /** F1: raw line twips for atLeast/exact */
  lineRawTwips?: number | undefined;
  spaceBeforeTwips?: number | undefined;
  spaceAfterTwips?: number | undefined;
  /** style-level w:beforeAutospacing / w:afterAutospacing (Word HTML auto = 14pt) */
  spaceBeforeAuto?: boolean | undefined;
  spaceAfterAuto?: boolean | undefined;
  /** indents from the style definition (w:pPr w:ind, twips; hanging is stored as a negative
   *  firstLine; an explicit 0 is kept so a child style cancels its parent's indent) */
  indentLeftTwips?: number | undefined;
  indentRightTwips?: number | undefined;
  indentFirstLineTwips?: number | undefined;
  /** character-unit indents from the style definition; their twips value depends
   *  on each paragraph's text, so the parser resolves them per paragraph */
  indentChars?: CharIndents | undefined;
  /** F1: keepNext from style definition */
  keepNext?: boolean | undefined;
  /** keepLines from style definition */
  keepLines?: boolean | undefined;
  /** pageBreakBefore from style definition */
  pageBreakBefore?: boolean | undefined;
  /** w:suppressAutoHyphens from style definition (tri-state: explicit off overrides the chain) */
  suppressAutoHyphens?: boolean | undefined;
  /** F1: contextualSpacing from style definition */
  contextualSpacing?: boolean | undefined;
  /** paragraph alignment from the style (w:pPr w:jc) */
  align?: ('left' | 'center' | 'right' | 'justify') | undefined;
  /** paragraph shading from the style (w:pPr w:shd w:fill, hex without '#') */
  shadingFill?: string | undefined;
  /** paragraph borders from the style (w:pPr w:pBdr, theme colors resolved; display-only) */
  borderSides?: ParaBorderSides | undefined;
  /** CJK-Latin/digit auto spacing from the style pPr (w:autoSpaceDE/DN) */
  autoSpace?: boolean | undefined;
  /** w:wordWrap from the style pPr; false = character-level breaking of hangul words */
  wordWrap?: boolean | undefined;
  /** w:overflowPunct from the style pPr; false = no hanging line-end punctuation */
  overflowPunct?: boolean | undefined;
  /** style rPr w:lang w:eastAsia (BCP-47) */
  eastAsiaLang?: string | undefined;
  /** style-level w:vanish (hidden text, e.g. z-TopofForm/z-BottomofForm HTML form markers) */
  vanish?: boolean | undefined;
}

/** display-only formatting a table style contributes (fills applied per tblLook flags) */
export interface TableStyleDisplay {
  /** whole-table cell shading (hex without '#') */
  fill?: string | undefined;
  /** whole-table run formatting (style-level w:rPr) */
  wholeTable?:
    | {
        color?: string | undefined;
        bold?: boolean | undefined;
        italic?: boolean | undefined;
        sizeHalfPoints?: number | undefined;
        kernHalfPoints?: number | undefined;
      }
    | undefined;
  /** conditional first-row formatting (w:tblStylePr w:type="firstRow") */
  firstRow?:
    | {
        fill?: string | undefined;
        bold?: boolean | undefined;
        color?: string | undefined;
        sizeHalfPoints?: number | undefined;
      }
    | undefined;
  /** conditional first/last-column and last-row formatting (w:tblStylePr) */
  firstCol?:
    | {
        fill?: string | undefined;
        bold?: boolean | undefined;
        color?: string | undefined;
        sizeHalfPoints?: number | undefined;
      }
    | undefined;
  lastCol?:
    | {
        fill?: string | undefined;
        bold?: boolean | undefined;
        color?: string | undefined;
        sizeHalfPoints?: number | undefined;
      }
    | undefined;
  lastRow?:
    | {
        fill?: string | undefined;
        bold?: boolean | undefined;
        color?: string | undefined;
        sizeHalfPoints?: number | undefined;
      }
    | undefined;
  /** odd-band row shading (band1Horz) */
  band1Fill?: string | undefined;
  /** even-band row shading (band2Horz) */
  band2Fill?: string | undefined;
  /** style-level table borders (w:tblPr w:tblBorders); fallback when the document level has none */
  borders?: TableBorders | undefined;
  /** style-level cell margins (w:tblPr w:tblCellMar) */
  cellMarTwips?: CellMargins | undefined;
  /** style-level w:pPr spacing applied to every cell paragraph (TableGrid carries
   * after=0/line=240 — the reason Word tables are tight while body text is loose) */
  paraSpacing?:
    | {
        beforeTwips?: number | undefined;
        afterTwips?: number | undefined;
        lineRawTwips?: number | undefined;
        lineRule?: ('auto' | 'atLeast' | 'exact') | undefined;
        lineSpacing?: number | undefined;
      }
    | undefined;
  /** style-level w:pPr w:jc applied to every cell paragraph (Calendar styles center) */
  paraJc?: string | undefined;
}

export interface StyleInfo {
  styleId: string;
  name: string;
  type: 'paragraph' | 'character' | 'table';
  headingLevel?: number | undefined;
  /** w:semiHidden — Word itself hides it from the style gallery (e.g. DefaultParagraphFont) */
  semiHidden?: boolean | undefined;
  /** w:qFormat — candidate for Word's quick style gallery */
  qFormat?: boolean | undefined;
  /** character shell linked to a paragraph style ("Heading 1 Char"); Word does not show it separately */
  linkedCharShell?: boolean | undefined;
  /** rendering hints from the style definition, basedOn chain resolved; never written back on save */
  display?: StyleDisplay | undefined;
  /** table-style rendering hints (type === 'table') */
  tableDisplay?: TableStyleDisplay | undefined;
  /** w:pPr/w:numPr on the style — list numbering referenced via pStyle (ListBullet/ListNumber);
   *  'none' = explicit w:numId 0 (cancels numbering inherited via basedOn) */
  numPr?: ({ numId: string; ilvl: number } | 'none') | undefined;
  /** w:default="1" — Word applies this style to every paragraph without a w:pStyle */
  isDefault?: boolean | undefined;
}

/** document-wide defaults from styles.xml w:docDefaults (display-only) */
export interface DocDefaults {
  sizeHalfPoints?: number | undefined;
  /** rPrDefault w:kern threshold in half-points (0 = explicitly off) */
  kernHalfPoints?: number | undefined;
  /** default Latin font (rPrDefault w:rFonts w:ascii) */
  asciiFont?: string | undefined;
  /** default Chinese font (rPrDefault w:rFonts w:eastAsia) — determines the CJK line-height factor */
  eastAsiaFont?: string | undefined;
  /** eastAsiaFont is a lang-based backfill for an empty theme slot, not a document choice */
  eaSlotEmpty?: boolean | undefined;
  /** eastAsiaFont was backfilled from w:lang w:eastAsia, not declared */
  eaFromLang?: boolean | undefined;
  /** bold/italic/color from rPrDefault (display-layer defaults, used by canvas CSS) */
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  /** hex without '#' */
  color?: string | undefined;
  lineSpacing?: number | undefined;
  /** F1: lineRule for accurate height calculation */
  lineRule?: ('auto' | 'atLeast' | 'exact') | undefined;
  /** F1: raw line twips for atLeast/exact */
  lineRawTwips?: number | undefined;
  /** F1: paragraph spacing before default (twips); undefined = not set in docDefaults */
  spaceBeforeTwips?: number | undefined;
  /** F1: paragraph spacing after default (twips); undefined = not set in docDefaults */
  spaceAfterTwips?: number | undefined;
  /** docDefaults-level w:beforeAutospacing / w:afterAutospacing (Word HTML auto = 14pt) */
  spaceBeforeAuto?: boolean | undefined;
  spaceAfterAuto?: boolean | undefined;
  /** rPrDefault w:lang w:val (BCP-47) — hyphenation/locale of the body text */
  lang?: string | undefined;
  /** rPrDefault w:lang w:eastAsia (BCP-47) */
  eastAsiaLang?: string | undefined;
  /** pPrDefault w:suppressAutoHyphens — every paragraph opts out of w:autoHyphenation */
  suppressAutoHyphens?: boolean | undefined;
}

/** word/settings.xml w:documentProtection (only the editing restriction subset). */
export interface DocProtection {
  /** w:edit value, e.g. "readOnly" | "comments" | "trackedChanges" | "forms" */
  edit: string;
  /** w:enforcement="1" — restriction is active */
  enforced: boolean;
  /** password hash (base64, Word 2013+ iterated SHA-512 scheme); absent when there is no password protection */
  hash?: string | undefined;
  /** salt (base64) */
  salt?: string | undefined;
  /** iteration count (w:cryptSpinCount), Word default 100000 */
  spinCount?: number | undefined;
  /** w:cryptAlgorithmSid, 14 = SHA-512 (the only supported value) */
  algorithmSid?: number | undefined;
}

/** word/settings.xml w:writeProtection (password to modify; honor-system, no encryption). */
export interface WriteProtection {
  /** w:recommended="1" — Word suggests opening read-only */
  recommended?: boolean | undefined;
  /** password-to-modify hash (base64, same iterated-SHA-512 scheme as DocProtection); absent = no modify password */
  hash?: string | undefined;
  /** salt (base64) */
  salt?: string | undefined;
  /** iteration count (w:cryptSpinCount), Word default 100000 */
  spinCount?: number | undefined;
  /** w:cryptAlgorithmSid, 14 = SHA-512 (the only supported value) */
  algorithmSid?: number | undefined;
}

/** One bibliography source (subset of the Word b:Sources schema). */
export interface SourceInfo {
  /** unique tag (b:Tag), e.g. "Wang2024" */
  tag: string;
  /** b:SourceType, e.g. "Book" | "JournalArticle" | "InternetSite" | "Report" */
  type: string;
  /** display author string (b:Author/b:Author/b:NameList or b:Corporate) */
  author: string;
  title: string;
  year: string;
  /** publisher / journal / site name, optional */
  publisher?: string | undefined;
  /** url for internet sources, optional */
  url?: string | undefined;
}

/** Font pair from word/theme/theme1.xml (latin typefaces + east-asian). */
export interface ThemeFonts {
  /** a:majorFont a:latin typeface (headings) */
  major: string;
  /** a:minorFont a:latin typeface (body) */
  minor: string;
  /** a:minorFont a:ea typeface (body east-asian), optional */
  eastAsia?: string | undefined;
  /** a:majorFont a:ea typeface (heading east-asian), optional */
  majorEastAsia?: string | undefined;
  /** a:majorFont / a:minorFont a:cs typefaces (complex script), optional */
  majorCs?: string | undefined;
  minorCs?: string | undefined;
  /** settings.xml w:themeFontLang w:eastAsia — picks Word's face for empty EA theme slots */
  eaLang?: string | undefined;
  /** settings.xml w:themeFontLang w:bidi — picks Word's face for empty cs theme slots */
  bidiLang?: string | undefined;
  /** per-script faces (<a:font script="Hang" typeface="…"/>) of each font group */
  majorScripts?: Record<string, string> | undefined;
  minorScripts?: Record<string, string> | undefined;
}

/** One word/fontTable.xml entry — Word's substitution hints for missing fonts. */
export interface FontTableEntry {
  name: string;
  /** w:altName — the face Word substitutes when the font is missing */
  altName?: string | undefined;
  /** w:panose1 hex digits (byte 2 = serif style: 02-0A serif, 0B-0F sans) */
  panose?: string | undefined;
  /** w:family — roman / swiss / modern / script / decorative / auto */
  family?: string | undefined;
  /** w:pitch — fixed / variable / default */
  pitch?: string | undefined;
  /** w:embedRegular / embedBold / embedItalic / embedBoldItalic parts */
  embedded?: Partial<Record<EmbeddedFontSlot, EmbeddedFontRef>> | undefined;
}

export type EmbeddedFontSlot = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface EmbeddedFontRef {
  rId: string;
  /** w:fontKey GUID that obfuscates the first 32 bytes of the part (ECMA-376 17.8.1) */
  fontKey?: string | undefined;
}

/** One de-obfuscated embedded face (word/fonts/*.odttf), ready for a FontFace. */
export interface EmbeddedFont {
  family: string;
  bold: boolean;
  italic: boolean;
  data: Uint8Array;
}

/** Color scheme values (hex without '#') from a:clrScheme. */
export interface ThemeColors {
  name?: string | undefined;
  /** read-only slots, populated by readThemeColors for w:themeColor resolution */
  dk1?: string | undefined;
  lt1?: string | undefined;
  hlink?: string | undefined;
  folHlink?: string | undefined;
  dk2?: string | undefined;
  lt2?: string | undefined;
  accent1?: string | undefined;
  accent2?: string | undefined;
  accent3?: string | undefined;
  accent4?: string | undefined;
  accent5?: string | undefined;
  accent6?: string | undefined;
}

export interface ParsedDoc {
  blocks: Block[];
  /** comments from word/comments.xml, in file order */
  comments: CommentInfo[];
  /** footnotes from word/footnotes.xml (separators excluded), file order */
  footnotes: NoteInfo[];
  /** endnotes from word/endnotes.xml (separators excluded), file order */
  endnotes: NoteInfo[];
  /** bibliography sources from the customXml b:Sources part */
  sources: SourceInfo[];
  /** aidocs-ink annotations (freehand strokes) found on body paragraphs, file order */
  inks: InkInfo[];
  /** theme font pair from word/theme/theme1.xml, null when the doc has no theme part */
  themeFonts?: (ThemeFonts | null) | undefined;
  /** word/fontTable.xml entries (substitution hints), absent when the part is missing/empty */
  fontTable?: FontTableEntry[] | undefined;
  /** faces embedded in the package (word/fonts), absent when none parse */
  embeddedFonts?: EmbeddedFont[] | undefined;
  /** color scheme from word/theme/theme1.xml, null when the doc has no theme part */
  themeColors?: (ThemeColors | null) | undefined;
  /** editing restriction from word/settings.xml, null when none */
  protection: DocProtection | null;
  /** password-to-modify / read-only-recommended from word/settings.xml, null when none */
  writeProtection: WriteProtection | null;
  /** settings.xml w:removePersonalInformation — remove author/organization metadata on save */
  removePersonalInfo: boolean;
  /** plain text of the default page header, null when the document has none */
  headerText?: (string | null) | undefined;
  /** rich paragraphs of the default header (PAGE fields appear as PAGE_MARK runs) */
  headerParas?: (HfParagraph[] | null) | undefined;
  /** rich paragraphs of the default footer */
  footerParas?: (HfParagraph[] | null) | undefined;
  /** display-only images (logos etc.) in the default header / footer */
  headerImages?: (HfImage[] | null) | undefined;
  footerImages?: (HfImage[] | null) | undefined;
  /** text watermark (VML textpath) in the default header, null when none */
  watermarkText?: (string | null) | undefined;
  /** plain text of the default page footer (PAGE fields appear as PAGE_MARK) */
  footerText?: (string | null) | undefined;
  /** the default footer contains an automatic page number field */
  footerHasPageNumber?: boolean | undefined;
  /** the default header contains an automatic page number field */
  headerHasPageNumber?: boolean | undefined;
  /** "different first page" (w:titlePg in a sectPr) */
  titlePg?: boolean | undefined;
  /** "different odd & even pages" (settings.xml w:evenAndOddHeaders) */
  evenAndOddHeaders?: boolean | undefined;
  /** settings.xml compatSetting compatibilityMode (0 when absent; >=15 = Word 2013+ layout) */
  compatibilityMode?: number | undefined;
  /** settings.xml <w:autoHyphenation/> — Word breaks words at line ends automatically */
  autoHyphenation?: boolean | undefined;
  /** settings.xml <w:balanceSingleByteDoubleByteWidth/> — rPr w:spacing counts double on double-byte characters */
  balanceDbcsSpacing?: boolean | undefined;
  /** settings.xml w:characterSpacingControl compressPunctuation* — justified CJK lines compress trailing-blank punctuation */
  compressPunctuation?: boolean | undefined;
  /** settings.xml w:compat <w:adjustLineHeightInTable/> — table-cell lines snap to the typed docGrid like body lines */
  adjustLineHeightInTable?: boolean | undefined;
  /** settings.xml w:defaultTabStop in twips (absent = Word's 720); 0 = zero-width default tabs */
  defaultTabStopTwips?: number | undefined;
  /** first-page header/footer parts (w:type="first"), null when absent */
  headerFirst?: (HfPartInfo | null) | undefined;
  footerFirst?: (HfPartInfo | null) | undefined;
  /** even-page header/footer parts (w:type="even"), null when absent */
  headerEven?: (HfPartInfo | null) | undefined;
  footerEven?: (HfPartInfo | null) | undefined;
  /** rId → header/footer part content (multi-section docs look these up via each section's sectPr refs) */
  hfParts?: Record<string, HfPartInfo> | undefined;
  /** styleId -> info, from word/styles.xml */
  styles: Map<string, StyleInfo>;
  /** document-wide display defaults from styles.xml */
  docDefaults?: DocDefaults | undefined;
  /** heading level -> styleId present in this document */
  headingStyleIds: Map<number, string>;
  /** styleId used for list paragraphs, if the doc has one (usually "ListParagraph") */
  listParagraphStyleId?: string | undefined;
  /** numId -> full numbering definition, from word/numbering.xml */
  numbering: Map<string, NumberingDef>;
  /** internal: everything needed to patch-save */
  internal: {
    originalBytes: Uint8Array;
    documentXml: string;
    /** inner body range [start, end) in documentXml covered by top-level elements */
    bodyInnerStart: number;
    bodyInnerEnd: number;
  };
}
