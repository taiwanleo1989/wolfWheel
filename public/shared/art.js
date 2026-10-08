// 角色美術（漫畫風 SVG）。轉盤的 6 個角色從 public/index.html 原樣搬來，加上守衛、白癡、平民。
// 用法：installArt() 一次 → 任何地方放 portrait('seer') 就有角色卡圖。
const INK = '#0d0b12';
const DEFS = `
<pattern id="dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.5" fill="#000" opacity=".32"/></pattern>
<pattern id="dotsLight" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.2" fill="#fff" opacity=".22"/></pattern>
<radialGradient id="ballGrad" cx=".38" cy=".34" r=".7"><stop offset="0" stop-color="#f2ffff"/><stop offset=".3" stop-color="#6ae6ff"/><stop offset=".72" stop-color="#2a5bd8"/><stop offset="1" stop-color="#1a1050"/></radialGradient>
<radialGradient id="seerGlow"><stop offset="0" stop-color="#7ff3ff" stop-opacity=".75"/><stop offset="1" stop-color="#7ff3ff" stop-opacity="0"/></radialGradient>
<radialGradient id="poisonGlow"><stop offset="0" stop-color="#7dff8a" stop-opacity=".7"/><stop offset="1" stop-color="#7dff8a" stop-opacity="0"/></radialGradient>
<radialGradient id="cureGlow"><stop offset="0" stop-color="#ff6a85" stop-opacity=".7"/><stop offset="1" stop-color="#ff6a85" stop-opacity="0"/></radialGradient>
<linearGradient id="poison" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b6ff9a"/><stop offset=".45" stop-color="#3fd65a"/><stop offset="1" stop-color="#11692a"/></linearGradient>
<linearGradient id="cure" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb3c0"/><stop offset=".45" stop-color="#ff3b5c"/><stop offset="1" stop-color="#8a0f26"/></linearGradient>
<radialGradient id="moonGrad" cx=".4" cy=".38" r=".7"><stop offset="0" stop-color="#fffbe6"/><stop offset=".6" stop-color="#f6e7b0"/><stop offset="1" stop-color="#d9b85c"/></radialGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="torchGlow"><stop offset="0" stop-color="#ffb347" stop-opacity=".75"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>`;

const sparkle = (x,y,r) => `M${x} ${y-r} Q${x} ${y} ${x+r} ${y} Q${x} ${y} ${x} ${y+r} Q${x} ${y} ${x-r} ${y} Q${x} ${y} ${x} ${y-r} Z`;
const S = `stroke="${INK}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"`;

function wolfArt(o){
  return `<g ${S}>
  ${o.king ? `<path d="M10 222 C24 176 62 166 100 184 C138 166 176 176 190 222 Z" fill="#9b1c22"/>
              <path d="M100 184 C128 170 164 172 178 196 L190 222 L148 222 Z" fill="#5c0f16" stroke="none"/>` : ''}
  <path d="M24 222 L32 182 L10 188 L34 150 L56 170 L70 198 L100 216 L130 198 L144 170 L166 150 L190 188 L168 182 L176 222 Z" fill="${o.shade}"/>
  <path d="M46 100 L28 20 L92 64 Z" fill="${o.fur}"/>
  <path d="M154 100 L172 20 L108 64 Z" fill="${o.fur}"/>
  <path d="M54 88 L40 40 L78 66 Z" fill="${o.ear}" stroke-width="3"/>
  <path d="M146 88 L160 40 L122 66 Z" fill="${o.ear}" stroke-width="3"/>
  <path d="M100 52 C132 52 154 66 160 90 L190 100 L166 112 L188 130 L160 132 L172 156 L140 146 L100 150 L60 146 L28 156 L40 132 L12 130 L34 112 L10 100 L40 90 C46 66 68 52 100 52 Z" fill="${o.fur}"/>
  <path d="M128 58 C146 66 156 78 160 90 L190 100 L166 112 L188 130 L160 132 L172 156 L140 146 C142 120 140 86 128 58 Z" fill="${o.shade}" stroke="none"/>
  <path d="M100 56 L92 76 L100 88 L108 76 Z" fill="${o.shade}" stroke="none"/>
  <path d="M62 148 L74 190 C86 210 114 210 126 190 L138 148 L146 160 L132 200 C118 220 82 220 68 200 L54 160 Z" fill="${o.fur}"/>
  <path d="M124 160 L138 148 L146 160 L132 200 C126 210 118 214 110 216 C124 200 128 180 124 160 Z" fill="${o.shade}" stroke="none"/>
  <path d="M68 148 C80 156 92 154 100 150 C108 154 120 156 132 148 L124 188 C114 204 86 204 76 188 Z" fill="#3d070e"/>
  <path d="M84 192 C88 178 112 178 116 192 C110 202 90 202 84 192 Z" fill="#d9475a" stroke-width="3"/>
  <path d="M100 182 L100 196" stroke="#8a1a2a" stroke-width="2.5"/>
  <path d="M72 150 L80 178 L88 154 Z M128 150 L120 178 L112 154 Z" fill="#fff8e8" stroke-width="3"/>
  <path d="M89 154 L93 166 L97 153 Z M103 153 L107 166 L111 154 Z" fill="#fff8e8" stroke-width="2.5"/>
  <path d="M79 190 L84 172 L90 192 Z M121 190 L116 172 L110 192 Z" fill="#fff8e8" stroke-width="2.5"/>
  <path d="M88 96 L112 96 L128 140 C122 152 78 152 72 140 Z" fill="${o.muzzle}"/>
  <path d="M106 96 L112 96 L128 140 C125 146 116 149 108 150 C118 136 114 112 106 96 Z" fill="${o.mshade}" stroke="none"/>
  <path d="M89 108 Q94 104 100 108 Q106 104 111 108 M87 116 Q93 112 100 116 Q107 112 113 116" fill="none" stroke-width="2.5"/>
  <path d="M82 134 C82 123 118 123 118 134 C118 142 108 147 100 147 C92 147 82 142 82 134 Z" fill="${INK}"/>
  <ellipse cx="93" cy="130" rx="5" ry="2.6" fill="#fff" stroke="none" opacity=".85"/>
  <path d="M118 194 C120 202 117 208 120 214" fill="none" stroke="#cfe8ff" stroke-width="3"/>
  <circle cx="120" cy="216" r="2.6" fill="#cfe8ff" stroke="none"/>
  <g filter="url(#glow)">
    <path d="M52 94 L88 102 L84 115 L60 111 Z" fill="${o.eye}"/>
    <path d="M148 94 L112 102 L116 115 L140 111 Z" fill="${o.eye}"/>
  </g>
  <path d="M70 100 L74 100 L73 113 L71 113 Z M130 100 L126 100 L127 113 L129 113 Z" fill="${INK}" stroke="none"/>
  <path d="M48 86 L92 99 M152 86 L108 99" stroke-width="7.5"/>
  <path d="M36 122 L52 126 M40 132 L54 134 M164 122 L148 126 M160 132 L146 134" stroke-width="2.5"/>
  ${o.king ? `
  <path d="M60 62 L64 18 L84 40 L100 6 L116 40 L136 18 L140 62 Z" fill="#f5b81c"/>
  <path d="M100 6 L116 40 L136 18 L140 62 L112 62 Z" fill="#c98a0a" stroke="none"/>
  <path d="M60 52 L140 52 L140 64 L60 64 Z" fill="#e0a312"/>
  <circle cx="100" cy="30" r="5.5" fill="#e0212f" stroke-width="3"/>
  <circle cx="80" cy="58" r="3.5" fill="#2fb8ff" stroke-width="2.5"/><circle cx="100" cy="58" r="3.5" fill="#e0212f" stroke-width="2.5"/><circle cx="120" cy="58" r="3.5" fill="#2fb8ff" stroke-width="2.5"/>
  <path d="M138 76 L122 126" stroke="#ff9a9a" stroke-width="4"/>
  <path d="M128 88 L137 92 M125 100 L134 104 M121 112 L130 116" stroke="#ff9a9a" stroke-width="2.5"/>` : ''}
</g>`;
}

const ART = {
wolf: () => wolfArt({fur:'#7b8496', shade:'#4b5263', muzzle:'#d8d2c4', mshade:'#b3ab9a', ear:'#9b4a5a', eye:'#ffd23f'}),
king: () => wolfArt({fur:'#3a3e4e', shade:'#1f222c', muzzle:'#8f93a3', mshade:'#6d7080', ear:'#6e2130', eye:'#ff4d3d', king:true}),
seer: () => `
<circle cx="100" cy="186" r="64" fill="url(#seerGlow)"/>
<g ${S}>
  <path d="M26 222 C22 150 40 80 100 36 C160 80 178 150 174 222 Z" fill="#4a2c82"/>
  <path d="M100 36 C160 80 178 150 174 222 L148 222 C154 160 142 92 100 36 Z" fill="#30195a" stroke="none"/>
  <path d="M60 122 C58 84 78 64 100 62 C122 64 142 84 140 122 C140 152 124 170 100 174 C76 170 60 152 60 122 Z" fill="#170c2e"/>
  <path d="M66 142 C60 108 72 84 96 78 C84 96 80 118 84 152 Z" fill="#dcd6f0"/>
  <path d="M134 142 C140 108 128 84 104 78 C116 96 120 118 116 152 Z" fill="#b9b1d6"/>
  <path d="M76 112 C76 90 88 80 100 80 C112 80 124 90 124 112 C124 134 114 150 100 152 C86 150 76 134 76 112 Z" fill="#f0c9a4"/>
  <path d="M110 82 C120 88 124 98 124 112 C124 134 114 150 100 152 C112 140 118 112 110 82 Z" fill="#d7a37e" stroke="none"/>
  <path d="M60 122 C58 84 78 64 100 62 C122 64 142 84 140 122" fill="none" stroke="#e7b84a" stroke-width="4"/>
  <path d="M89 93 Q100 85 111 93 Q100 101 89 93 Z" fill="#f5d36a" stroke-width="2.5"/>
  <circle cx="100" cy="93" r="3.2" fill="#2ad8ff" stroke="none" filter="url(#glow)"/>
  <g filter="url(#glow)">
    <path d="M82 114 Q89 108 96 114 Q89 118 82 114 Z" fill="#a8f8ff" stroke-width="2.5"/>
    <path d="M104 114 Q111 108 118 114 Q111 118 104 114 Z" fill="#a8f8ff" stroke-width="2.5"/>
  </g>
  <path d="M81 105 Q89 100 96 104 M104 104 Q111 100 119 105" fill="none" stroke-width="3"/>
  <path d="M100 118 L96 130 L102 131" fill="none" stroke-width="2.5"/>
  <path d="M93 140 Q100 143 107 140" fill="none" stroke-width="3"/>
  <path d="M42 222 C50 192 74 176 100 176 C126 176 150 192 158 222 Z" fill="#5b3a99"/>
  <path d="M68 186 L100 202 L132 186" fill="none" stroke="#e7b84a" stroke-width="5"/>
  <path d="M56 206 C52 188 68 176 78 186 C84 196 78 214 66 214 Z" fill="#f0c9a4"/>
  <path d="M144 206 C148 188 132 176 122 186 C116 196 122 214 134 214 Z" fill="#d7a37e"/>
  <circle cx="100" cy="190" r="31" fill="url(#ballGrad)"/>
  <path d="M84 194 C88 178 108 178 112 190 C114 200 100 204 96 196" fill="none" stroke="#fff" stroke-width="2.5" opacity=".7"/>
  <ellipse cx="89" cy="178" rx="8" ry="4.5" fill="#fff" stroke="none" opacity=".9" transform="rotate(-30 89 178)"/>
</g>
<g fill="#fff3a8" stroke="${INK}" stroke-width="2"><path d="${sparkle(30,64,11)}"/><path d="${sparkle(172,56,8)}"/><path d="${sparkle(160,150,6)}"/><path d="${sparkle(40,160,6)}"/></g>`,
witch: () => `
<circle cx="40" cy="182" r="40" fill="url(#poisonGlow)"/>
<circle cx="160" cy="182" r="40" fill="url(#cureGlow)"/>
<g ${S}>
  <path d="M48 100 C24 150 38 196 22 222 L178 222 C162 196 176 150 152 100 Z" fill="#3a1f4d"/>
  <path d="M130 100 L152 100 C176 150 162 196 178 222 L148 222 C152 180 150 130 130 100 Z" fill="#26123a" stroke="none"/>
  <path d="M52 222 L64 166 L100 186 L136 166 L148 222 Z" fill="#4a1d66"/>
  <path d="M90 138 L110 138 L112 174 L100 182 L88 174 Z" fill="#e2cbbb"/>
  <path d="M74 98 C74 84 86 78 100 78 C114 78 126 84 126 98 C126 124 116 142 100 144 C84 142 74 124 74 98 Z" fill="#f1e0d4"/>
  <path d="M114 80 C122 84 126 90 126 98 C126 124 116 142 100 144 C114 132 120 108 114 80 Z" fill="#dcc3b3" stroke="none"/>
  <path d="M72 100 C78 88 90 86 98 82 C102 92 116 88 128 100 L130 92 C122 78 78 78 70 92 Z" fill="#3a1f4d"/>
  <path d="M81 109 Q88 103 96 108" fill="none" stroke-width="4.5"/>
  <path d="M104 108 Q112 103 119 109" fill="none" stroke-width="4.5"/>
  <path d="M83 109 Q89 115 95 109 Z" fill="#6dff7f" stroke-width="2" filter="url(#glow)"/>
  <path d="M105 109 Q111 115 117 109 Z" fill="#6dff7f" stroke-width="2" filter="url(#glow)"/>
  <circle cx="89" cy="110.5" r="1.8" fill="${INK}" stroke="none"/><circle cx="111" cy="110.5" r="1.8" fill="${INK}" stroke="none"/>
  <path d="M81 109 L75 104 M119 109 L125 104" stroke-width="3"/>
  <path d="M80 97 Q88 90 97 96 M103 96 Q112 90 120 97" fill="none" stroke-width="3"/>
  <path d="M100 113 L96 123 L101 124" fill="none" stroke-width="2.5"/>
  <path d="M89 130 Q101 137 113 127" fill="none" stroke="#b3122a" stroke-width="4.5"/>
  <path d="M113 127 L116 124" stroke-width="2.5"/>
  <circle cx="117" cy="133" r="1.7" fill="${INK}" stroke="none"/>
  <path d="M22 92 C38 72 162 72 178 92 C162 106 38 106 22 92 Z" fill="#1e3a2f"/>
  <path d="M58 86 C66 56 86 34 110 8 C118 0 132 4 124 12 C114 28 126 52 144 86 Z" fill="#244a3b"/>
  <path d="M110 8 C118 0 132 4 124 12 C114 28 126 52 144 86 L126 86 C118 60 112 34 110 8 Z" fill="#163026" stroke="none"/>
  <path d="M60 76 C88 84 116 84 142 76 L145 88 C116 96 88 96 58 88 Z" fill="#7a2fa0"/>
  <rect x="92" y="80" width="16" height="12" fill="none" stroke="#f5b81c" stroke-width="3.5"/>
  <path d="M34 146 L46 146 L46 158 C60 162 66 176 62 188 C58 202 22 202 18 188 C14 176 20 162 34 158 Z" fill="url(#poison)"/>
  <rect x="31" y="138" width="18" height="10" rx="2" fill="#8b5a2b" stroke-width="3"/>
  <circle cx="40" cy="180" r="8" fill="#fff" stroke-width="2.5"/>
  <circle cx="37" cy="179" r="2" fill="${INK}" stroke="none"/><circle cx="43" cy="179" r="2" fill="${INK}" stroke="none"/>
  <path d="M36 188 L44 188" stroke-width="2"/>
  <path d="M154 146 L166 146 L166 158 C180 162 186 176 182 188 C178 202 142 202 138 188 C134 176 140 162 154 158 Z" fill="url(#cure)"/>
  <rect x="151" y="138" width="18" height="10" rx="2" fill="#8b5a2b" stroke-width="3"/>
  <path d="M160 188 C150 180 152 172 156 172 C158 172 160 174 160 176 C160 174 162 172 164 172 C168 172 170 180 160 188 Z" fill="#fff" stroke-width="2.5"/>
</g>
<g fill="#cfffd0" opacity=".8"><circle cx="30" cy="128" r="3"/><circle cx="46" cy="118" r="2"/><circle cx="38" cy="106" r="2.6"/></g>
<g fill="#ffd0da" opacity=".8"><circle cx="170" cy="128" r="3"/><circle cx="156" cy="118" r="2"/><circle cx="164" cy="106" r="2.6"/></g>`,
hunter: () => `
<g ${S}>
  <path d="M24 222 C30 184 62 168 100 166 C138 168 170 184 176 222 Z" fill="#6b3f1f"/>
  <path d="M120 168 C148 172 170 186 176 222 L136 222 C140 200 134 180 120 168 Z" fill="#4a2a12" stroke="none"/>
  <path d="M84 168 L100 196 L116 168 Z" fill="#b3202a"/>
  <path d="M90 176 L110 176 M94 184 L106 184" stroke="#5c0f16" stroke-width="2.5"/>
  <path d="M54 176 C66 166 76 164 86 166 L100 196 L74 190 L62 200 Z" fill="#e9dcc0"/>
  <path d="M146 176 C134 166 124 164 114 166 L100 196 L126 190 L138 200 Z" fill="#d4c6a6"/>
  <path d="M86 146 L114 146 L116 170 L84 170 Z" fill="#c48d5f"/>
  <ellipse cx="66" cy="118" rx="6" ry="9" fill="#d9a679"/>
  <ellipse cx="134" cy="118" rx="6" ry="9" fill="#c48d5f"/>
  <path d="M68 96 L132 96 L134 128 C130 150 116 162 100 162 C84 162 70 150 66 128 Z" fill="#d9a679"/>
  <path d="M118 96 L132 96 L134 128 C130 150 116 162 100 162 C116 150 122 128 118 96 Z" fill="#b98457" stroke="none"/>
  <path d="M68 96 L132 96 L133 110 C112 104 88 104 67 110 Z" fill="#9c6a40" stroke="none"/>
  <path d="M68 124 C72 150 88 164 100 164 C112 164 128 150 132 124 C124 140 112 144 100 144 C88 144 76 140 68 124 Z" fill="#4a2e1a"/>
  <path d="M83 133 C90 126 98 128 100 131 C102 128 110 126 117 133 C110 137 104 136 100 135 C96 136 90 137 83 133 Z" fill="#3a2212"/>
  <path d="M93 142 Q100 145 107 142" fill="none" stroke-width="2.5"/>
  <path d="M77 114 L95 116" stroke-width="4.5"/>
  <ellipse cx="111" cy="115" rx="7.5" ry="5" fill="#fff" stroke-width="3"/>
  <circle cx="112" cy="115" r="3" fill="${INK}" stroke="none"/>
  <path d="M74 106 L97 111 M103 110 L125 104" stroke-width="5.5"/>
  <path d="M100 112 L95 127 L104 127" fill="none" stroke-width="3"/>
  <path d="M121 120 L129 133 M121 126 L126 124 M124 131 L129 129" stroke="#7a2a1a" stroke-width="2.5"/>
  <path d="M20 100 C44 82 156 82 180 100 C156 112 44 112 20 100 Z" fill="#5a3a1a"/>
  <path d="M60 94 C58 62 74 46 100 46 C126 46 142 62 140 94 Z" fill="#6e4723"/>
  <path d="M112 47 C132 52 142 68 140 94 L122 94 C124 74 120 58 112 47 Z" fill="#53341a" stroke="none"/>
  <path d="M84 50 Q100 62 116 50" fill="none" stroke-width="3"/>
  <path d="M60 82 C86 88 114 88 140 82 L140 94 C114 100 86 100 60 94 Z" fill="#2b1a0c"/>
  <path d="M136 88 C150 60 170 44 190 36 C178 56 164 78 140 94 Z" fill="#c4202f"/>
  <path d="M140 92 C156 72 170 56 186 40" fill="none" stroke-width="2"/>
  <g transform="rotate(-24 100 198)">
    <path d="M4 192 L62 184 L66 208 L12 216 Z" fill="#8b5a2b"/>
    <path d="M14 200 L56 194" stroke="#5c3a18" stroke-width="2.5"/>
    <path d="M62 184 L110 184 L110 200 L66 202 Z" fill="#3b3b44"/>
    <path d="M110 186 L206 186 L206 196 L110 196 Z" fill="#6b707c"/>
    <path d="M110 191 L206 191" stroke-width="2"/>
    <path d="M78 202 L84 214 L92 202" fill="none" stroke-width="3"/>
    <path d="M118 196 C116 186 132 182 138 190 C142 198 134 210 124 208 Z" fill="#d9a679"/>
    <path d="M68 200 C66 190 82 186 88 194 C92 202 84 212 74 210 Z" fill="#c48d5f"/>
  </g>
</g>`,
knight: () => `
<g ${S}>
  <path d="M22 222 C28 180 62 162 100 160 C138 162 172 180 178 222 Z" fill="#1f3f8a"/>
  <path d="M120 162 C150 168 172 184 178 222 L140 222 C142 196 136 176 120 162 Z" fill="#142b63" stroke="none"/>
  <path d="M92 176 L108 176 L108 190 L124 190 L124 204 L108 204 L108 222 L92 222 L92 204 L76 204 L76 190 L92 190 Z" fill="#f5b81c"/>
  <path d="M22 190 C24 162 50 150 72 158 C68 176 50 188 22 190 Z" fill="#c3ccd6"/>
  <path d="M30 184 C36 170 50 164 62 164" fill="none" stroke-width="2.5"/>
  <path d="M178 190 C176 162 150 150 128 158 C132 176 150 188 178 190 Z" fill="#8a96a4"/>
  <path d="M62 146 L138 146 L134 168 C118 174 82 174 66 168 Z" fill="#9aa5b1"/>
  <path d="M100 48 C86 22 96 4 122 0 C112 12 130 16 118 30 C128 30 134 38 120 48 Z" fill="#c4202f"/>
  <path d="M104 44 C98 30 104 16 114 8 M110 46 C110 36 116 30 122 28" fill="none" stroke="#7d0f1a" stroke-width="2.5"/>
  <path d="M56 146 L56 88 C56 60 76 44 100 44 C124 44 144 60 144 88 L144 146 C130 156 70 156 56 146 Z" fill="#c3ccd6"/>
  <path d="M110 46 C130 52 144 68 144 88 L144 146 C136 152 124 154 116 154 C126 120 124 72 110 46 Z" fill="#7f8b99" stroke="none"/>
  <path d="M66 72 C70 60 80 52 88 50 C80 62 74 78 72 98 L66 98 Z" fill="#fff" stroke="none" opacity=".8"/>
  <path d="M100 46 L100 98" stroke-width="3"/>
  <path d="M62 100 L138 100 L138 111 L106 111 L106 142 L94 142 L94 111 L62 111 Z" fill="${INK}"/>
  <g filter="url(#glow)"><ellipse cx="80" cy="105.5" rx="8" ry="2.6" fill="#bfe8ff"/><ellipse cx="120" cy="105.5" rx="8" ry="2.6" fill="#bfe8ff"/></g>
  <g fill="${INK}" stroke="none"><circle cx="80" cy="124" r="2.6"/><circle cx="80" cy="133" r="2.6"/><circle cx="120" cy="124" r="2.6"/><circle cx="120" cy="133" r="2.6"/></g>
  <g fill="#f5b81c" stroke-width="2"><circle cx="64" cy="140" r="3"/><circle cx="136" cy="140" r="3"/><circle cx="64" cy="84" r="3"/><circle cx="136" cy="84" r="3"/></g>
  <path d="M161 46 L175 46 L175 166 L161 166 Z" fill="#e4eaf1"/>
  <path d="M161 46 L168 22 L175 46 Z" fill="#e4eaf1"/>
  <path d="M168 34 L168 160" stroke="#9aa5b1" stroke-width="2.5"/>
  <path d="M146 166 L190 166 L186 177 L150 177 Z" fill="#f5b81c"/>
  <rect x="163" y="177" width="10" height="24" fill="#5a3412"/>
  <circle cx="168" cy="206" r="6.5" fill="#f5b81c"/>
  <path d="M152 182 C152 172 184 172 184 183 L184 196 C184 203 152 203 152 196 Z" fill="#9aa5b1"/>
  <path d="M160 182 L160 200 M168 182 L168 200 M176 182 L176 200" stroke-width="2"/>
</g>`,
guard: () => `
<g ${S}>
  <path d="M30 222 L52 34 L64 36 L44 222 Z" fill="#6b4220"/>
  <path d="M50 38 L58 0 L68 40 Z" fill="#dfe6ee"/>
  <path d="M24 222 C30 182 62 166 100 164 C138 166 170 182 176 222 Z" fill="#6b4a1f"/>
  <path d="M120 166 C148 172 170 186 176 222 L138 222 C142 198 136 178 120 166 Z" fill="#4a3214" stroke="none"/>
  <path d="M64 160 L136 160 L130 182 C116 188 84 188 70 182 Z" fill="#9aa5b1"/>
  <path d="M72 168 L128 168 M76 176 L124 176" stroke="#5f6a78" stroke-width="2"/>
  <path d="M86 144 L114 144 L116 164 L84 164 Z" fill="#d9a679"/>
  <path d="M70 98 L130 98 L132 126 C128 146 116 156 100 156 C84 156 72 146 68 126 Z" fill="#e0b088"/>
  <path d="M118 98 L130 98 L132 126 C128 146 116 156 100 156 C114 146 120 124 118 98 Z" fill="#c4946c" stroke="none"/>
  <path d="M82 132 C90 126 98 128 100 131 C102 128 110 126 118 132 C112 138 104 136 100 135 C96 136 88 138 82 132 Z" fill="#5a3a1a"/>
  <path d="M92 144 L108 144" stroke-width="3"/>
  <ellipse cx="86" cy="114" rx="6" ry="4.2" fill="#fff" stroke-width="2.5"/>
  <ellipse cx="114" cy="114" rx="6" ry="4.2" fill="#fff" stroke-width="2.5"/>
  <circle cx="87" cy="114.5" r="2.6" fill="${INK}" stroke="none"/><circle cx="113" cy="114.5" r="2.6" fill="${INK}" stroke="none"/>
  <path d="M75 106 L96 110 M104 110 L125 106" stroke-width="5.5"/>
  <path d="M30 100 C50 86 150 86 170 100 C150 112 50 112 30 100 Z" fill="#8a96a4"/>
  <path d="M62 96 C60 62 78 46 100 46 C122 46 140 62 138 96 Z" fill="#b8c2cc"/>
  <path d="M112 48 C130 54 140 70 138 96 L120 96 C124 76 120 60 112 48 Z" fill="#7f8b99" stroke="none"/>
  <path d="M70 66 C74 56 82 50 90 48 C82 58 78 70 76 84 L70 84 Z" fill="#fff" stroke="none" opacity=".75"/>
  <path d="M62 86 L138 86" stroke-width="3"/>
  <g fill="#f5b81c" stroke-width="2"><circle cx="74" cy="80" r="2.8"/><circle cx="100" cy="78" r="2.8"/><circle cx="126" cy="80" r="2.8"/></g>
  <path d="M96 100 L104 100 L104 124 C102 127 98 127 96 124 Z" fill="#9aa5b1"/>
  <circle cx="122" cy="192" r="52" fill="#8b5a2b"/>
  <path d="M84 158 L84 226 M104 142 L104 238 M140 142 L140 238 M160 158 L160 226" stroke="#5c3a18" stroke-width="2.5"/>
  <circle cx="122" cy="192" r="46" fill="none" stroke="#9aa5b1" stroke-width="8"/>
  <circle cx="122" cy="192" r="52" fill="none"/>
  <circle cx="120" cy="194" r="24" fill="#f5d36a" stroke-width="3"/>
  <circle cx="130" cy="187" r="20" fill="#8b5a2b" stroke-width="3"/>
</g>`,
idiot: () => `
<g fill="#fff3a8" stroke="${INK}" stroke-width="2"><path d="${sparkle(34,120,8)}"/><path d="${sparkle(168,124,7)}"/><path d="${sparkle(150,30,6)}"/></g>
<g ${S}>
  <path d="M24 222 C30 182 62 166 100 164 L100 222 Z" fill="#c4202f"/>
  <path d="M100 164 C138 166 170 182 176 222 L100 222 Z" fill="#f5b81c"/>
  <path d="M56 170 L66 156 L76 172 L88 158 L100 174 L112 158 L124 172 L134 156 L144 170 L134 186 L100 192 L66 186 Z" fill="#fff8e8"/>
  <path d="M70 108 C70 86 84 76 100 76 C116 76 130 86 130 108 C130 134 116 152 100 152 C84 152 70 134 70 108 Z" fill="#f2cfa8"/>
  <path d="M116 80 C126 88 130 96 130 108 C130 134 116 152 100 152 C116 138 122 108 116 80 Z" fill="#dcb08a" stroke="none"/>
  <ellipse cx="80" cy="128" rx="7" ry="4" fill="#ff8a8a" stroke="none" opacity=".6"/>
  <ellipse cx="120" cy="128" rx="7" ry="4" fill="#ff8a8a" stroke="none" opacity=".6"/>
  <circle cx="86" cy="108" r="7.5" fill="#fff" stroke-width="2.5"/>
  <circle cx="114" cy="108" r="7.5" fill="#fff" stroke-width="2.5"/>
  <circle cx="90" cy="109" r="3.2" fill="${INK}" stroke="none"/><circle cx="110" cy="109" r="3.2" fill="${INK}" stroke="none"/>
  <path d="M77 95 Q86 88 95 95 M105 95 Q114 88 123 95" fill="none" stroke-width="3"/>
  <circle cx="100" cy="120" r="6" fill="#e8a080" stroke-width="3"/>
  <path d="M80 130 Q100 154 120 130 Q100 138 80 130 Z" fill="#7a1a24"/>
  <path d="M88 133 L98 135 L98 141 L90 139 Z M102 135 L112 133 L110 139 L102 141 Z" fill="#fff" stroke-width="2"/>
  <path d="M70 90 C56 58 34 46 14 58 C34 58 50 72 64 96 Z" fill="#c4202f"/>
  <path d="M130 90 C144 58 166 46 186 58 C166 58 150 72 136 96 Z" fill="#c4202f"/>
  <path d="M84 84 C86 52 94 26 100 10 C106 26 114 52 116 84 Z" fill="#f5b81c"/>
  <path d="M100 10 C106 26 114 52 116 84 L106 84 C106 56 104 30 100 10 Z" fill="#c98a0a" stroke="none"/>
  <path d="M64 86 C80 78 120 78 136 86 L134 98 C118 92 82 92 66 98 Z" fill="#2c4596"/>
  <g fill="#f5d36a" stroke-width="3"><circle cx="14" cy="60" r="7"/><circle cx="100" cy="10" r="7"/><circle cx="186" cy="60" r="7"/></g>
</g>`,
villager: () => `
<circle cx="158" cy="70" r="50" fill="url(#torchGlow)"/>
<g ${S}>
  <path d="M24 222 C30 184 62 168 100 166 C138 168 170 184 176 222 Z" fill="#8a6a3a"/>
  <path d="M120 168 C148 172 170 186 176 222 L138 222 C142 198 136 178 120 168 Z" fill="#6b5028" stroke="none"/>
  <path d="M72 172 L86 222 M128 172 L114 222" stroke="#4a3418" stroke-width="6"/>
  <path d="M84 168 L100 184 L116 168" fill="none" stroke-width="3"/>
  <path d="M88 146 L112 146 L114 170 L86 170 Z" fill="#e6b98f"/>
  <path d="M72 104 C72 86 84 78 100 78 C116 78 128 86 128 104 C128 130 116 150 100 150 C84 150 72 130 72 104 Z" fill="#f0c9a4"/>
  <path d="M116 82 C124 88 128 96 128 104 C128 130 116 150 100 150 C114 136 120 108 116 82 Z" fill="#d7a37e" stroke="none"/>
  <g fill="#b0703a" stroke="none"><circle cx="80" cy="124" r="1.6"/><circle cx="85" cy="128" r="1.6"/><circle cx="78" cy="130" r="1.6"/><circle cx="120" cy="124" r="1.6"/><circle cx="115" cy="128" r="1.6"/><circle cx="122" cy="130" r="1.6"/></g>
  <ellipse cx="88" cy="111" rx="5.5" ry="6.5" fill="#fff" stroke-width="2.5"/>
  <ellipse cx="112" cy="111" rx="5.5" ry="6.5" fill="#fff" stroke-width="2.5"/>
  <circle cx="89" cy="112" r="2.8" fill="${INK}" stroke="none"/><circle cx="113" cy="112" r="2.8" fill="${INK}" stroke="none"/>
  <path d="M80 99 Q88 96 95 101 M105 101 Q112 96 120 99" fill="none" stroke-width="3"/>
  <path d="M100 116 L97 125 L102 126" fill="none" stroke-width="2.5"/>
  <ellipse cx="100" cy="137" rx="5" ry="4.5" fill="#7a1a24" stroke-width="2.5"/>
  <path d="M74 98 C80 88 92 90 96 86 C100 92 112 88 126 98 L126 90 C116 80 84 80 74 90 Z" fill="#7a4a1f"/>
  <path d="M22 92 C44 76 156 76 178 92 C156 106 44 106 22 92 Z" fill="#e8c86a"/>
  <path d="M66 88 C64 62 80 50 100 50 C120 50 136 62 134 88 Z" fill="#d9b24f"/>
  <path d="M74 60 L78 86 M88 52 L90 86 M110 52 L110 86 M124 58 L122 86" stroke="#b08a2c" stroke-width="2"/>
  <path d="M66 78 C88 84 112 84 134 78 L134 88 C112 94 88 94 66 88 Z" fill="#a3202a"/>
  <path d="M130 210 L150 96 L162 98 L142 212 Z" fill="#6b4220"/>
  <path d="M147 102 L165 105 L163 116 L145 113 Z" fill="#8a96a4"/>
  <path d="M156 102 C138 88 144 68 154 56 C154 70 162 68 160 52 C174 64 180 84 168 102 Z" fill="#ff8a1c"/>
  <path d="M157 99 C150 90 153 80 158 72 C160 81 167 84 164 99 Z" fill="#ffe066" stroke="none"/>
  <path d="M124 198 C122 186 140 182 146 190 C150 198 142 212 132 210 Z" fill="#f0c9a4"/>
</g>`
};

// 每個角色卡的底色（深）與放射線（亮）
export const ART_BG = {
  wolf: ['#16224f', '#2c4596'], king: ['#4a0c12', '#a3202a'], seer: ['#26114f', '#6a3cbc'],
  witch: ['#0f3426', '#2a8f55'], hunter: ['#4d2c10', '#b5651c'], knight: ['#122444', '#4f74ae'],
  guard: ['#2e2410', '#9c7a2c'], idiot: ['#3b1f45', '#d4a017'], villager: ['#1f2e14', '#5f8a34'],
};

function sunburst(color) {
  let d = '';
  for (let i = 0; i < 18; i++) {
    const a0 = (i * 20) * Math.PI / 180, a1 = (i * 20 + 10) * Math.PI / 180;
    d += `M100 120 L${100 + 320 * Math.sin(a0)} ${120 - 320 * Math.cos(a0)} L${100 + 320 * Math.sin(a1)} ${120 - 320 * Math.cos(a1)} Z `;
  }
  return `<path d="${d}" fill="${color}" opacity=".55"/>`;
}

export function installArt() {
  if (document.getElementById('ww-art')) return;
  let symbols = '';
  for (const [id, [bg, bg2]] of Object.entries(ART_BG)) {
    symbols += `<symbol id="art-${id}" viewBox="0 0 200 220"><rect width="200" height="220" fill="${bg}"/>${sunburst(bg2)}<rect width="200" height="220" fill="url(#dots)"/>${ART[id]()}</symbol>`;
  }
  const holder = document.createElement('div');
  holder.innerHTML = `<svg id="ww-art" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${DEFS}${symbols}</defs></svg>`;
  document.body.prepend(holder.firstChild);
}

export const portrait = id => `<svg viewBox="0 0 200 220" aria-hidden="true"><use href="#art-${id}"/></svg>`;
