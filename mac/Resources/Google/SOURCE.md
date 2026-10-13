# Google "G"

`google-g.png`, `@2x` and `@3x` are Google's standard colour "G", rendered unchanged from the official Sign in with
Google asset bundle (`https://developers.google.com/static/identity/images/signin-assets.zip`, file
`Android + Web/SVG/Light/Theme=Light, Show text=No, Shape=Square, Platform=Android+Web.svg`). Only the button's own
white square and grey border were left out, so the G sits on a transparent background inside Standby's
"Continue with Google" button; its shape, colours and proportions are Google's. It was rasterised with headless
Chrome at 20, 40 and 60 px (the logo is 20 × 20 pt on the button, as the guidelines specify).

The button follows Google's custom-button guidance at
https://developers.google.com/identity/branding-guidelines: white fill, a 1 px `#747775` stroke inside, Google Sans
Medium 14/20 in `#1F1F1F`, 12 px before the logo, 10 px after it, 12 px after the text, pill shape, 40 tall, and
`#303030` state layers at 8% (hover) and 12% (pressed).

`../Fonts/GoogleSans-Medium.ttf` is Google Sans (SIL Open Font License, no Reserved Font Name) from
`github.com/google/fonts/ofl/googlesans`, instanced at Medium (wght 500, opsz 18, GRAD 0) and subset to Latin with
fonttools 4.60.1, so it is 40 KB instead of 5 MB. Its licence is `../Fonts/GoogleSans-OFL.txt`.
