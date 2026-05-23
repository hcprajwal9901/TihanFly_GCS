/**
 * i18n.js — TiHANFly GCS — Multi-Language Support
 * Languages: English, Tamil, Telugu, Hindi, Kannada, Malayalam
 *
 * Usage:
 *   1. Add this file BEFORE </body> in MainWindow.html:
 *      <script src="i18n.js"></script>
 *
 *   2. Add the language selector button in the header HTML:
 *      <div id="langSelectorWrap"></div>
 *      (see instructions below for exact placement)
 *
 *   3. Add data-i18n="KEY" attributes to any element you want translated.
 *      The script auto-translates all elements with that attribute on lang change.
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     TRANSLATION DICTIONARY
     Each key maps to { en, ta, te, hi, kn, ml }
  ═══════════════════════════════════════════════════════════════ */
  const TRANSLATIONS = {

    /* ── Header ── */
    'status.ready':        { en: 'Ready To Fly', ta: 'பறக்க தயார்', te: 'ఎగరడానికి సిద్ధం', hi: 'उड़ान के लिए तैयार', kn: 'ಹಾರಲು ಸಿದ್ಧ', ml: 'പറക്കാൻ തയ്യാർ' },
    'status.disconnected': { en: 'Disconnected',  ta: 'துண்டிக்கப்பட்டது', te: 'డిస్‌కనెక్ట్ అయింది', hi: 'डिस्कनेक्ट', kn: 'ಸಂಪರ್ಕ ಕಡಿದಿದೆ', ml: 'ബന്ധം വിച്ഛേദിച്ചു' },
    'status.connected':    { en: 'Connected',     ta: 'இணைக்கப்பட்டது', te: 'కనెక్ట్ అయింది', hi: 'कनेक्टेड', kn: 'ಸಂಪರ್ಕಿತ', ml: 'ബന്ധിപ്പിച്ചിരിക്കുന്നു' },
    'header.hold':         { en: 'Hold',          ta: 'நிறுத்து', te: 'హోల్డ్', hi: 'होल्ड', kn: 'ಹೋಲ್ಡ್', ml: 'ഹോൾഡ്' },

    /* ── Flight Control Buttons ── */
    'btn.arm':      { en: 'ARM',      ta: 'ஆர்ம்',  te: 'ఆర్మ్',  hi: 'आर्म', kn: 'ಆರ್ಮ್', ml: 'ആം' },
    'btn.disarm':   { en: 'DISARM',   ta: 'நிராயுதம்', te: 'డిసార్మ్', hi: 'डिसार्म', kn: 'ಡಿಸಾರ್ಮ್', ml: 'ഡിസ്‌ആം' },
    'btn.takeoff':  { en: 'TAKEOFF',  ta: 'புறப்படு', te: 'టేకాఫ్', hi: 'टेकऑफ', kn: 'ಟೇಕ್‌ಆಫ್', ml: 'ടേക്ക്ഓഫ്' },
    'btn.land':     { en: 'LAND',     ta: 'தரையிறங்கு', te: 'ల్యాండ్', hi: 'लैंड', kn: 'ಲ್ಯಾಂಡ್', ml: 'ലാൻഡ്' },
    'btn.rtl':      { en: 'RTL',      ta: 'திரும்பு', te: 'ఆర్‌టిఎల్', hi: 'आरटीएल', kn: 'ಆರ್‌ಟಿಎಲ್', ml: 'ആർടിഎൽ' },
    'btn.mode':     { en: 'MODE',     ta: 'பயன்முறை', te: 'మోడ్', hi: 'मोड', kn: 'ಮೋಡ್', ml: 'മോഡ്' },

    /* ── Dropdown Menu ── */
    'menu.plan':     { en: 'PLAN',     ta: 'திட்டம்',   te: 'ప్లాన్',    hi: 'प्लान', kn: 'ಯೋಜನೆ', ml: 'പ്ലാൻ' },
    'menu.analyze':  { en: 'ANALYZE',  ta: 'பகுப்பாய்வு', te: 'విశ్లేషణ', hi: 'विश्लेषण', kn: 'ವಿಶ್ಲೇಷಣೆ', ml: 'വിശകലനം' },
    'menu.config':   { en: 'CONFIG',   ta: 'அமைவு',     te: 'కాన్ఫిగ్', hi: 'कॉन्फिग', kn: 'ಕಾನ್ಫಿಗ್', ml: 'കോൺഫിഗ്' },
    'menu.settings': { en: 'SETTINGS', ta: 'அமைப்புகள்', te: 'సెట్టింగులు', hi: 'सेटिंग्स', kn: 'ಸೆಟ್ಟಿಂಗ್ಸ್', ml: 'ക്രമീകരണം' },

    /* ── Flight Mode Panel ── */
    'mode.panel.title':  { en: 'Select Flight Mode', ta: 'விமான பயன்முறை தேர்வு', te: 'ఫ్లైట్ మోడ్ ఎంచుకోండి', hi: 'फ्लाइट मोड चुनें', kn: 'ಫ್ಲೈಟ್ ಮೋಡ್ ಆಯ್ಕೆ ಮಾಡಿ', ml: 'ഫ്ലൈറ്റ് മോഡ് തിരഞ്ഞെടുക്കുക' },
    'mode.stabilize':    { en: 'Stabilize',     ta: 'நிலைப்படுத்து',  te: 'స్టెబిలైజ్', hi: 'स्टेबलाइज़', kn: 'ಸ್ಥಿರೀಕರಿಸು', ml: 'സ്ഥിരപ്പെടുത്തൽ' },
    'mode.acro':         { en: 'Acro',          ta: 'அக்ரோ',          te: 'ఆక్రో', hi: 'एक्रो', kn: 'ಆಕ್ರೋ', ml: 'ആക്രോ' },
    'mode.althold':      { en: 'Altitude Hold', ta: 'உயரம் தக்க வை', te: 'ఎత్తు హోల్డ్', hi: 'ऊंचाई होल्ड', kn: 'ಎತ್ತರ ಹಿಡಿತ', ml: 'ഉയർ‌ ഹോൾഡ്' },
    'mode.auto':         { en: 'Auto',          ta: 'தானியங்கி',      te: 'ఆటో', hi: 'ऑटो', kn: 'ಆಟೋ', ml: 'ഓട്ടോ' },
    'mode.guided':       { en: 'Guided',        ta: 'வழிகாட்டப்பட்ட', te: 'గైడెడ్', hi: 'गाइडेड', kn: 'ಮಾರ್ಗದರ್ಶಿ', ml: 'ഗൈഡഡ്' },
    'mode.loiter':       { en: 'Loiter',        ta: 'சுழல்',          te: 'లాయిటర్', hi: 'लॉइटर', kn: 'ಲಾಯ್ಟರ್', ml: 'ലോയ്റ്ററ്' },
    'mode.rtl':          { en: 'RTL',           ta: 'திரும்பு',         te: 'ఆర్‌టిఎల్', hi: 'आरटीएल', kn: 'ಆರ್‌ಟಿಎಲ್', ml: 'ആർടിഎൽ' },
    'mode.circle':       { en: 'Circle',        ta: 'வட்டம்',         te: 'సర్కిల్', hi: 'सर्किल', kn: 'ವೃತ್ತ', ml: 'സർക്കിൾ' },
    'mode.land':         { en: 'Land',          ta: 'தரையிறங்கு',    te: 'ల్యాండ్', hi: 'लैंड', kn: 'ಲ್ಯಾಂಡ್', ml: 'ലാൻഡ്' },
    'mode.sport':        { en: 'Sport',         ta: 'விளையாட்டு',     te: 'స్పోర్ట్', hi: 'स्पोर्ट', kn: 'ಸ್ಪೋರ್ಟ್', ml: 'സ്‌പോർട്ട്' },
    'mode.drift':        { en: 'Drift',         ta: 'சறுக்கல்',      te: 'డ్రిఫ్ట్', hi: 'ड्रिफ्ट', kn: 'ಡ್ರಿಫ್ಟ್', ml: 'ഡ്രിഫ്റ്റ്' },
    'mode.position':     { en: 'Position',      ta: 'நிலை',           te: 'పొజిషన్', hi: 'पोजीशन', kn: 'ಸ್ಥಾನ', ml: 'പൊസിഷൻ' },
    'mode.followme':     { en: 'Follow Me',     ta: 'என்னை பின்தொடர்', te: 'ఫాలో మీ', hi: 'फॉलो मी', kn: 'ನನ್ನ ಹಿಂದೆ', ml: 'ഫോളോ മി' },
    'mode.smartrtl':     { en: 'Smart RTL',     ta: 'ஸ்மார்ட் திரும்பு', te: 'స్మార్ట్ ఆర్‌టిఎల్', hi: 'स्मार्ट RTL', kn: 'ಸ್ಮಾರ್ಟ್ ಆರ್‌ಟಿಎಲ್', ml: 'സ്‌മാർട്ട് ആർടിഎൽ' },
    'mode.tag.basic':    { en: 'BASIC',  ta: 'அடிப்படை', te: 'బేసిక్', hi: 'बेसिक', kn: 'ಮೂಲ', ml: 'ബേസിക്' },
    'mode.tag.expert':   { en: 'EXPERT', ta: 'நிபுணர்',   te: 'ఎక్స్‌పర్ట్', hi: 'एक्सपर्ट', kn: 'ತಜ್ಞ', ml: 'വിദഗ്ദ്ധൻ' },
    'mode.tag.auto':     { en: 'AUTO',   ta: 'தானியங்கி', te: 'ఆటో', hi: 'ऑटो', kn: 'ಆಟೋ', ml: 'ഓട്ടോ' },
    'mode.tag.gps':      { en: 'GPS',    ta: 'ஜிபிஎஸ்',   te: 'జిపిఎస్', hi: 'जीपीएस', kn: 'ಜಿಪಿಎಸ್', ml: 'ജിപിഎസ്' },

    /* ── Plan Flight Menu ── */
    'plan.file':           { en: 'FILE',     ta: 'கோப்பு',   te: 'ఫైల్',   hi: 'फ़ाइल', kn: 'ಫೈಲ್', ml: 'ഫയൽ' },
    'plan.takeoff':        { en: 'TAKEOFF',  ta: 'புறப்படு', te: 'టేకాఫ్', hi: 'टेकऑफ', kn: 'ಟೇಕ್‌ಆಫ್', ml: 'ടേക്ക്ഓഫ്' },
    'plan.waypoint':       { en: 'WAYPOINT', ta: 'வழிப்புள்ளி', te: 'వేపాయింట్', hi: 'वेपॉइंट', kn: 'ವೇಪಾಯಿಂಟ್', ml: 'വേപോയിൻ്റ്' },
    'plan.polygon':        { en: 'POLYGON',  ta: 'பலகோணம்', te: 'పాలిగాన్', hi: 'पॉलिगॉन', kn: 'ಬಹುಭುಜ', ml: 'ബഹുഭുജം' },
    'plan.return':         { en: 'RETURN',   ta: 'திரும்பு', te: 'రిటర్న్', hi: 'वापस', kn: 'ವಾಪಸ್', ml: 'തിരിരി' },
    'plan.center':         { en: 'CENTER',   ta: 'மையம்',    te: 'సెంటర్', hi: 'केंद्र', kn: 'ಕೇಂದ್ರ', ml: 'കേന്ദ്രം' },
    'plan.new-mission':    { en: 'New Mission',    ta: 'புதிய பயணம்',     te: 'కొత్త మిషన్',    hi: 'नया मिशन', kn: 'ಹೊಸ ಮಿಷನ್', ml: 'പുതിയ ദൗത്യം' },
    'plan.open-mission':   { en: 'Open Mission',   ta: 'பயணம் திற',       te: 'మిషన్ తెరవు',    hi: 'मिशन खोलें', kn: 'ಮಿಷನ್ ತೆರೆ', ml: 'ദൗത്യം തുറക്കുക' },
    'plan.save-mission':   { en: 'Save Mission',   ta: 'பயணம் சேமி',     te: 'మిషన్ సేవ్',     hi: 'मिशन सेव करें', kn: 'ಮಿಷನ್ ಉಳಿಸಿ', ml: 'ദൗത്യം സേവ് ചെയ്യുക' },
    'plan.write-drone':    { en: '📡 Write to Drone', ta: '📡 ഡ്രോണിലേക്ക് എഴുതുക', te: '📡 డ్రోన్‌కు రాయి', hi: '📡 ड्रोन को लिखें', kn: '📡 ಡ್ರೋನ್‌ಗೆ ಬರೆಯಿರಿ', ml: '📡 ഡ്രോണിലേക്ക് എഴുതുക' },
    'plan.takeoff-here':   { en: 'Takeoff Here',   ta: 'இங்கு புறப்படு', te: 'ఇక్కడ టేకాఫ్',  hi: 'यहाँ टेकऑफ', kn: 'ಇಲ್ಲಿ ಟೇಕ್‌ಆಫ್', ml: 'ഇവിടെ ടേക്ക്ഓഫ്' },
    'plan.set-home':       { en: 'Set Home Position', ta: 'வீடு நிலை அமை', te: 'హోమ్ పొజిషన్ సెట్', hi: 'होम पोजीशन सेट करें', kn: 'ಮನೆ ಸ್ಥಾನ ಹೊಂದಿಸಿ', ml: 'ഹോം സ്ഥാനം ക്രമീകരിക്കുക' },
    'plan.clear-home':     { en: 'Clear Home',       ta: 'வீடு அழி',       te: 'హోమ్ క్లియర్',   hi: 'होम क्लियर करें', kn: 'ಮನೆ ತೆರವು', ml: 'ഹോം ക്ലിയർ ചെയ്യുക' },
    'plan.add-waypoint':   { en: 'Add Waypoint',   ta: 'வழிப்புள்ளி சேர்', te: 'వేపాయింట్ జోడించు', hi: 'वेपॉइंट जोड़ें', kn: 'ವೇಪಾಯಿಂಟ್ ಸೇರಿಸಿ', ml: 'വേപോയിൻ്റ് ചേർക്കുക' },
    'plan.send-markers':   { en: '📡 Send Markers', ta: '📡 குறிகள் அனுப்பு', te: '📡 మార్కర్లు పంపు', hi: '📡 मार्कर भेजें', kn: '📡 ಮಾರ್ಕರ್ ಕಳಿಸಿ', ml: '📡 മാർക്കറുകൾ അയക്കുക' },
    'plan.delete-waypoint':{ en: 'Delete Waypoint', ta: 'வழிப்புள்ளி நீக்கு', te: 'వేపాయింట్ తొలగించు', hi: 'वेपॉइंट हटाएं', kn: 'ವೇಪಾಯಿಂಟ್ ಅಳಿಸಿ', ml: 'വേപോയിൻ്റ് ഇല്ലാതാക്കുക' },
    'plan.clear-all':      { en: 'Clear All',       ta: 'அனைத்தும் அழி', te: 'అన్నీ క్లియర్', hi: 'सभी क्लियर करें', kn: 'ಎಲ್ಲ ತೆರವು', ml: 'എല്ലാം ക്ലിയർ ചെയ്യുക' },
    'plan.draw-polygon':   { en: 'Draw Polygon',    ta: 'பலகோணம் வரை', te: 'పాలిగాన్ వేయి', hi: 'पॉलिगॉन बनाएं', kn: 'ಬಹುಭುಜ ಎಳೆ', ml: 'ബഹുഭുജം വരയ്ക്കുക' },
    'plan.edit-polygon':   { en: 'Edit Polygon',    ta: 'பலகோணம் திருத்து', te: 'పాలిగాన్ సవరించు', hi: 'पॉलिगॉन संपादित करें', kn: 'ಬಹುಭುಜ ಸಂಪಾದಿಸಿ', ml: 'ബഹുഭുജം എഡിറ്റ് ചെയ്യുക' },
    'plan.survey-settings':{ en: 'Survey Settings',  ta: 'ஆய்வு அமைப்புகள்', te: 'సర్వే సెట్టింగులు', hi: 'सर्वे सेटिंग्स', kn: 'ಸಮೀಕ್ಷೆ ಸೆಟ್ಟಿಂಗ್ಸ್', ml: 'സർവേ ക്രമീകരണം' },
    'plan.send-drone':     { en: '📡 Send to Drone', ta: '📡 ஡ரோனுக்கு அனுப்பு', te: '📡 డ్రోన్‌కు పంపు', hi: '📡 ड्रोन को भेजें', kn: '📡 ಡ್ರೋನ್‌ಗೆ ಕಳಿಸಿ', ml: '📡 ഡ്രോണിലേക്ക് അയക്കുക' },
    'plan.clear-polygon':  { en: 'Clear Polygon', ta: 'பலகோணம் அழி', te: 'పాలిగాన్ క్లియర్', hi: 'पॉलिगॉन क्लियर करें', kn: 'ಬಹುಭುಜ ತೆರವು', ml: 'ബഹുഭുജം ക്ലിയർ ചെയ്യുക' },
    'plan.rtl':            { en: 'Return to Launch', ta: 'ஆரம்ப இடத்திற்கு திரும்பு', te: 'లాంచ్‌కు తిరిగి రా', hi: 'लॉन्च पर वापस जाएं', kn: 'ಲಾಂಚ್‌ಗೆ ಹಿಂತಿರುಗು', ml: 'ലോഞ്ചിലേക്ക് മടങ്ങുക' },
    'plan.land-here':      { en: 'Land Here',       ta: 'இங்கு தரையிறங்கு', te: 'ఇక్కడ ల్యాండ్', hi: 'यहाँ लैंड करें', kn: 'ಇಲ್ಲಿ ಲ್ಯಾಂಡ್', ml: 'ഇവിടെ ലാൻഡ് ചെയ്യുക' },
    'plan.center-mission': { en: 'Center Mission', ta: 'பயண மையம்', te: 'మిషన్ సెంటర్', hi: 'मिशन केंद्र', kn: 'ಮಿಷನ್ ಕೇಂದ್ರ', ml: 'ദൗത്യ കേന്ദ്രം' },
    'plan.center-vehicle': { en: 'Center Vehicle', ta: 'வாகன மையம்', te: 'వాహన సెంటర్', hi: 'वाहन केंद्र', kn: 'ವಾಹನ ಕೇಂದ್ರ', ml: 'വാഹന കേന്ദ്രം' },
    'plan.center-home':    { en: 'Center Home',    ta: 'வீட்டு மையம்', te: 'హోమ్ సెంటర్', hi: 'होम केंद्र', kn: 'ಮನೆ ಕೇಂದ್ರ', ml: 'ഹോം കേന്ദ്രം' },

    /* ── Command Editor ── */
    'editor.title':        { en: 'Command Editor',  ta: 'கட்டளை திருத்தி', te: 'కమాండ్ ఎడిటర్', hi: 'कमांड एडिटर', kn: 'ಕಮಾಂಡ್ ಎಡಿಟರ್', ml: 'കമാൻഡ് എഡിറ്റർ' },
    'editor.tab.waypoints':{ en: 'Waypoints', ta: 'வழிப்புள்ளிகள்', te: 'వేపాయింట్లు', hi: 'वेपॉइंट्स', kn: 'ವೇಪಾಯಿಂಟ್ಗಳು', ml: 'വേപോയിൻ്റുകൾ' },
    'editor.no-waypoints': { en: 'No waypoints added yet', ta: 'வழிப்புள்ளிகள் இல்லை', te: 'వేపాయింట్లు జోడించలేదు', hi: 'कोई वेपॉइंट नहीं जोड़ा', kn: 'ಇನ್ನೂ ಯಾವುದೇ ವೇಪಾಯಿಂಟ್ ಇಲ್ಲ', ml: 'ഒരു വേപോയിൻ്റും ചേർത്തിട്ടില്ല' },
    'editor.add-hint':     { en: 'Click "Add Waypoint" to start', ta: '"வழிப்புள்ளி சேர்" என்பதை கிளிக் செய்யவும்', te: '"వేపాయింట్ జోడించు" క్లిక్ చేయండి', hi: 'शुरू करने के लिए "वेपॉइंट जोड़ें" क्लिक करें', kn: 'ಪ್ರಾರಂಭಿಸಲು "ವೇಪಾಯಿಂಟ್ ಸೇರಿಸಿ" ಕ್ಲಿಕ್ ಮಾಡಿ', ml: 'ആരംഭിക്കാൻ "വേപോയിൻ്റ് ചേർക്കുക" ക്ലിക്ക് ചെയ്യുക' },
    'editor.back':         { en: 'Back to List', ta: 'பட்டியலுக்கு திரும்பு', te: 'జాబితాకు తిరిగి వెళ్ళు', hi: 'सूची पर वापस', kn: 'ಪಟ್ಟಿಗೆ ಹಿಂತಿರುಗು', ml: 'ലിസ്‌റ്റിലേക്ക് തിരിരി' },
    'editor.wp-id':        { en: 'Waypoint ID', ta: 'வழிப்புள்ளி ஐடி', te: 'వేపాయింట్ ఐడి', hi: 'वेपॉइंट आईडी', kn: 'ವೇಪಾಯಿಂಟ್ ಐಡಿ', ml: 'വേപോയിൻ്റ് ഐഡി' },
    'editor.latitude':     { en: 'Latitude',    ta: 'அட்சரேகை',       te: 'అక్షాంశం',      hi: 'अक्षांश', kn: 'ಅಕ್ಷಾಂಶ', ml: 'അക്ഷാംശം' },
    'editor.longitude':    { en: 'Longitude',   ta: 'தீர்க்கரேகை',    te: 'రేఖాంశం',       hi: 'देशांतर', kn: 'ರೇಖಾಂಶ', ml: 'രേഖാംശം' },
    'editor.altitude':     { en: 'Altitude (meters)', ta: 'உயரம் (மீட்டர்)', te: 'ఎత్తు (మీటర్లు)', hi: 'ऊंचाई (मीटर)', kn: 'ಎತ್ತರ (ಮೀಟರ್)', ml: 'ഉയരം (മീറ്റർ)' },
    'editor.type':         { en: 'Type',        ta: 'வகை',             te: 'రకం',            hi: 'प्रकार', kn: 'ಪ್ರಕಾರ', ml: 'തരം' },
    'editor.save':         { en: 'Save Changes', ta: 'மாற்றங்கள் சேமி', te: 'మార్పులు సేవ్ చేయి', hi: 'बदलाव सेव करें', kn: 'ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸಿ', ml: 'മാറ്റങ്ങൾ സേവ് ചെയ്യുക' },
    'editor.delete-wp':    { en: 'Delete Waypoint', ta: 'வழிப்புள்ளி நீக்கு', te: 'వేపాయింట్ తొలగించు', hi: 'वेपॉइंट हटाएं', kn: 'ವೇಪಾಯಿಂಟ್ ಅಳಿಸಿ', ml: 'വേപോയിൻ്റ് ഇല്ലാതാക്കുക' },

    /* ── Fence Panel ── */
    'fence.none':       { en: 'No geofences created yet', ta: 'ஜியோஃபென்ஸ் இல்லை', te: 'జియోఫెన్స్ సృష్టించలేదు', hi: 'कोई जियोफेंस नहीं बनाया', kn: 'ಯಾವುದೇ ಜಿಯೋಫೆನ್ಸ್ ಇಲ್ಲ', ml: 'ഒരു ജിയോഫെൻസും സൃഷ്‌ടിച്ചിട്ടില്ല' },
    'fence.hint':       { en: 'Use POLYGON menu to draw fences', ta: 'POLYGON மெனு பயன்படுத்தவும்', te: 'POLYGON మెనూ ఉపయోగించండి', hi: 'POLYGON मेनू का उपयोग करें', kn: 'POLYGON ಮೆನು ಬಳಸಿ', ml: 'POLYGON മെനു ഉപയോഗിക്കുക' },
    'fence.id':         { en: 'Fence ID',   ta: 'வேலி ஐடி',    te: 'ఫెన్స్ ఐడి',    hi: 'फेंस आईडी', kn: 'ಫೆನ್ಸ್ ಐಡಿ', ml: 'ഫെൻസ് ഐഡി' },
    'fence.type':       { en: 'Fence Type', ta: 'வேலி வகை',     te: 'ఫెన్స్ రకం',    hi: 'फेंस प्रकार', kn: 'ಫೆನ್ಸ್ ಪ್ರಕಾರ', ml: 'ഫെൻസ് തരം' },
    'fence.points':     { en: 'Points',     ta: 'புள்ளிகள்',   te: 'పాయింట్లు',      hi: 'पॉइंट्स', kn: 'ಬಿಂದುಗಳು', ml: 'പോയിൻ്റുകൾ' },
    'fence.save':       { en: 'Save Changes', ta: 'மாற்றங்கள் சேமி', te: 'మార్పులు సేవ్ చేయి', hi: 'बदलाव सेव करें', kn: 'ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸಿ', ml: 'മാറ്റങ്ങൾ സേവ് ചെയ്യുക' },
    'fence.delete':     { en: 'Delete Fence', ta: 'வேலி நீக்கு', te: 'ఫెన్స్ తొలగించు', hi: 'फेंस हटाएं', kn: 'ಫೆನ್ಸ್ ಅಳಿಸಿ', ml: 'ഫെൻസ് ഇല്ലാതാക്കുക' },

    /* ── Rally Panel ── */
    'rally.none':       { en: 'No rally points set',     ta: 'ரேலி புள்ளிகள் இல்லை', te: 'రాలీ పాయింట్లు లేవు', hi: 'कोई रैली पॉइंट नहीं', kn: 'ಯಾವುದೇ ರ್ಯಾಲಿ ಪಾಯಿಂಟ್ ಇಲ್ಲ', ml: 'ഒരു റാലി പോയിൻ്റും ക്രമീകരിച്ചിട്ടില്ല' },
    'rally.hint':       { en: 'Click map to add rally points', ta: 'வரைபடத்தை கிளிக் செய்யவும்', te: 'మ్యాప్‌ను క్లిక్ చేయండి', hi: 'मैप पर क्लिक करें', kn: 'ನಕ್ಷೆಯನ್ನು ಕ್ಲಿಕ್ ಮಾಡಿ', ml: 'മാപ്പ് ക്ലിക്ക് ചെയ്യുക' },
    'rally.id':         { en: 'Rally Point ID', ta: 'ரேலி புள்ளி ஐடி', te: 'రాలీ పాయింట్ ఐడి', hi: 'रैली पॉइंट आईडी', kn: 'ರ್ಯಾಲಿ ಪಾಯಿಂಟ್ ಐಡಿ', ml: 'റാലി പോയിൻ്റ് ഐഡി' },
    'rally.save':       { en: 'Save Changes',   ta: 'மாற்றங்கள் சேமி', te: 'మార்పులు సేవ్ చేయి', hi: 'बदलाव सेव करें', kn: 'ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸಿ', ml: 'മാറ്റങ്ങൾ സേവ് ചെയ്യുക' },
    'rally.delete':     { en: 'Delete Rally Point', ta: 'ரேலி புள்ளி நீக்கு', te: 'రాలీ పాయింట్ తొలగించు', hi: 'रैली पॉइंट हटाएं', kn: 'ರ್ಯಾಲಿ ಪಾಯಿಂಟ್ ಅಳಿಸಿ', ml: 'റാലി പോയിൻ്റ് ഇല്ലാതാക്കുക' },

    /* ── Takeoff Modal ── */
    'takeoff.modal.title':    { en: '🚁 Takeoff Configuration', ta: '🚁 புறப்படு அமைவு', te: '🚁 టేకాఫ్ కాన్ఫిగరేషన్', hi: '🚁 टेकऑफ कॉन्फिगरेशन', kn: '🚁 ಟೇಕ್‌ಆಫ್ ಕಾನ್ಫಿಗರೇಶನ್', ml: '🚁 ടേക്ക്ഓഫ് കോൺഫിഗറേഷൻ' },
    'takeoff.altitude.label': { en: 'Target Altitude', ta: 'இலக்கு உயரம்', te: 'లక్ష్య ఎత్తు', hi: 'लक्ष्य ऊंचाई', kn: 'ಗುರಿ ಎತ್ತರ', ml: 'ലക്ഷ്യ ഉയരം' },
    'takeoff.speed.label':    { en: 'Climb Speed', ta: 'ஏறும் வேகம்', te: 'క్లైంబ్ స్పీడ్', hi: 'चढ़ाई गति', kn: 'ಏರು ವೇಗ', ml: 'ക്ലൈംബ് വേഗത' },
    'takeoff.cancel':         { en: 'Cancel',  ta: 'ரத்து',  te: 'రద్దు', hi: 'रद्द करें', kn: 'ರದ್ದು', ml: 'റദ്ദാക്കുക' },
    'takeoff.confirm':        { en: 'Confirm Takeoff', ta: 'புறப்படலை உறுதி', te: 'టేకాఫ్ నిర్ధారించు', hi: 'टेकऑफ की पुष्टि करें', kn: 'ಟೇಕ್‌ಆಫ್ ದೃಢೀಕರಿಸಿ', ml: 'ടേക്ക്ഓഫ് സ്ഥിരീകരിക്കുക' },
    'takeoff.progress.title': { en: 'Takeoff Progress', ta: 'புறப்படு முன்னேற்றம்', te: 'టేకాఫ్ ప్రోగ్రెస్', hi: 'टेकऑफ प्रगति', kn: 'ಟೇಕ್‌ಆಫ್ ಪ್ರಗತಿ', ml: 'ടേക്ക്ഓഫ് പ്രോഗ്രസ്' },
    'takeoff.initiating':     { en: 'Initiating takeoff...', ta: 'புறப்படல் தொடங்குகிறது...', te: 'టేకాఫ్ ప్రారంభిస్తోంది...', hi: 'टेकऑफ शुरू हो रहा है...', kn: 'ಟೇಕ್‌ಆಫ್ ಆರಂಭಿಸುತ್ತಿದೆ...', ml: 'ടേക്ക്ഓഫ് ആരംഭിക്കുന്നു...' },

    /* ── Weather Dashboard ── */
    'weather.title':      { en: 'Weather',           ta: 'வானிலை',         te: 'వాతావరణం',   hi: 'मौसम', kn: 'ಹವಾಮಾನ', ml: 'കാലാവസ്ഥ' },
    'weather.loading':    { en: 'Loading weather data...', ta: 'வானிலை ஏற்றுகிறது...', te: 'వాతావరణ డేటా లోడ్ అవుతోంది...', hi: 'मौसम डेटा लोड हो रहा है...', kn: 'ಹವಾಮಾನ ಡೇಟಾ ಲೋಡ್ ಆಗುತ್ತಿದೆ...', ml: 'കാലാവസ്ഥ ഡാറ്റ ലോഡ് ചെയ്യുന്നു...' },
    'weather.error':      { en: 'Failed to load weather data', ta: 'வானிலை ஏற்றல் தோல்வி', te: 'వాతావరణ డేటా లోడ్ విఫలమైంది', hi: 'मौसम डेटा लोड नहीं हुआ', kn: 'ಹವಾಮಾನ ಡೇಟಾ ಲೋಡ್ ವಿಫಲ', ml: 'കാലാവസ്ഥ ഡാറ്റ ലോഡ് ചെയ്‌തില്ല' },
    'weather.retry':      { en: 'Retry',              ta: 'மீண்டும் முயற்சி', te: 'మళ్ళీ ప్రయత్నించు', hi: 'फिर से कोशिश करें', kn: 'ಮರುಪ್ರಯತ್ನ', ml: 'വീണ്ടും ശ്രമിക്കുക' },
    'weather.feels-like': { en: 'Feels Like',         ta: 'உணரும் வெப்பம்', te: 'అనిపించే ఉష్ణోగ్రత', hi: 'महसूस होता है', kn: 'ಅನಿಸಿಕೆ', ml: 'തോന്നൽ' },
    'weather.humidity':   { en: 'Humidity',           ta: 'ஈரப்பதம்',       te: 'తేమ',          hi: 'आर्द्रता', kn: 'ತೇವಾಂಶ', ml: 'ആർദ്രത' },
    'weather.wind':       { en: 'Wind Speed',         ta: 'காற்று வேகம்',   te: 'గాలి వేగం',    hi: 'हवा की गति', kn: 'ಗಾಳಿ ವೇಗ', ml: 'കാറ്റ് വേഗത' },
    'weather.pressure':   { en: 'Pressure',           ta: 'அழுத்தம்',       te: 'ఒత్తిడి',      hi: 'दबाव', kn: 'ಒತ್ತಡ', ml: 'മർദ്ദം' },
    'weather.visibility': { en: 'Visibility',         ta: 'தெரிவுநிலை',     te: 'దృశ్యమానత',    hi: 'दृश्यता', kn: 'ಗೋಚರತೆ', ml: 'ദൃശ്യപരത' },
    'weather.clouds':     { en: 'Clouds',             ta: 'மேகங்கள்',       te: 'మేఘాలు',       hi: 'बादल', kn: 'ಮೋಡ', ml: 'മേഘങ്ങൾ' },
    'weather.click':      { en: 'Click map to load weather', ta: 'வரைபடத்தை கிளிக் செய்யவும்', te: 'వాతావరణానికి మ్యాప్ క్లిక్ చేయండి', hi: 'मौसम लोड करने के लिए मैप क्लिक करें', kn: 'ಹವಾಮಾನ ಲೋಡ್ ಮಾಡಲು ನಕ್ಷೆ ಕ್ಲಿಕ್ ಮಾಡಿ', ml: 'കാലാവസ്ഥ ലോഡ് ചെയ്യാൻ മാപ്പ് ക്ലിക്ക് ചെയ്യുക' },

    /* ── Vehicle Config ── */
    'vc.title':           { en: 'Vehicle Configuration', ta: 'வாகன அமைவு', te: 'వాహన కాన్ఫిగరేషన్', hi: 'वाहन कॉन्फिगरेशन', kn: 'ವಾಹನ ಕಾನ್ಫಿಗರೇಶನ್', ml: 'വാഹന കോൺഫിഗറേഷൻ' },
    'vc.serial-port':     { en: 'Select Serial Port:', ta: 'சீரியல் போர்ட் தேர்வு:', te: 'సీరియల్ పోర్ట్ ఎంచుకోండి:', hi: 'सीरियल पोर्ट चुनें:', kn: 'ಸೀರಿಯಲ್ ಪೋರ್ಟ್ ಆಯ್ಕೆ:', ml: 'സീരിയൽ പോർട്ട് തിരഞ്ഞെടുക്കുക:' },
    'vc.refresh':         { en: 'Refresh Ports', ta: 'போர்ட்கள் புதுப்பி', te: 'పోర్ట్లు రిఫ్రెష్', hi: 'पोर्ट्स रिफ्रेश करें', kn: 'ಪೋರ್ಟ್ಗಳನ್ನು ರಿಫ್ರೆಶ್ ಮಾಡಿ', ml: 'പോർട്ടുകൾ പുതുക്കുക' },
    'vc.drone-type':      { en: 'Select Drone Type', ta: '஡ரோன் வகை தேர்வு', te: 'డ్రోన్ రకం ఎంచుకోండి', hi: 'ड्रोन प्रकार चुनें', kn: 'ಡ್ರೋನ್ ವಿಧ ಆಯ್ಕೆ ಮಾಡಿ', ml: 'ഡ്രോൺ തരം തിരഞ്ഞെടുക്കുക' },
    'vc.flash-log':       { en: 'Flashing Log:', ta: 'ஃப்ளாஷிங் பதிவு:', te: 'ఫ్లాషింగ్ లాగ్:', hi: 'फ्लैशिंग लॉग:', kn: 'ಫ್ಲಾಶಿಂಗ್ ಲಾಗ್:', ml: 'ഫ്ലാഷിംഗ് ലോഗ്:' },
    'vc.erase-progress':  { en: 'Erase Progress:', ta: 'அழிப்பு முன்னேற்றம்:', te: 'ఎరేజ్ ప్రోగ్రెస్:', hi: 'इरेज़ प्रगति:', kn: 'ಅಳಿಸಿ ಪ್ರಗತಿ:', ml: 'ഇല്ലാതാക്കൽ പ്രോഗ്രസ്:' },
    'vc.write-progress':  { en: 'Write Progress:', ta: 'எழுதும் முன்னேற்றம்:', te: 'రైట్ ప్రోగ్రెస్:', hi: 'राइट प्रगति:', kn: 'ಬರೆ ಪ್ರಗತಿ:', ml: 'റൈറ്റ് പ്രോഗ്രസ്:' },

    /* ── Analyze Tools ── */
    'at.title':             { en: 'Analyze Tools', ta: 'பகுப்பாய்வு கருவிகள்', te: 'విశ్లేషణ సాధనాలు', hi: 'विश्लेषण उपकरण', kn: 'ವಿಶ್ಲೇಷಣಾ ಉಪಕರಣಗಳು', ml: 'വിശകലന ഉപകരണങ്ങൾ' },
    'at.back':              { en: 'Back', ta: 'திரும்பு', te: 'వెనక్కి', hi: 'वापस', kn: 'ಹಿಂದೆ', ml: 'പിന്നോട്ട്' },
    
    'at.tool.logdl':        { en: 'Log Download' },
    'at.tool.logdl.desc':   { en: 'Flight log files' },
    'at.tool.review':       { en: 'Review a Log' },
    'at.tool.review.desc':  { en: 'Analyze flight log' },
    'at.tool.geotag':       { en: 'GeoTag Images' },
    'at.tool.geotag.desc':  { en: 'GPS-tag photos' },
    'at.tool.console':      { en: 'MAVLink Console' },
    'at.tool.console.desc': { en: 'Vehicle shell' },
    'at.tool.inspect':      { en: 'MAVLink Inspector' },
    'at.tool.inspect.desc': { en: 'Live messages' },
    'at.tool.vib':          { en: 'Vibration' },
    'at.tool.vib.desc':     { en: 'IMU sensor data' },

    'at.log.refresh':       { en: 'Refresh' },
    'at.log.dl_sel':        { en: 'Download Selected' },
    'at.log.del_all':       { en: 'Delete All' },
    'at.log.no_conn':       { en: '● Not Connected' },
    'at.log.id':            { en: 'ID' },
    'at.log.date':          { en: 'Date' },
    'at.log.time':          { en: 'Time' },
    'at.log.size':          { en: 'Size' },
    'at.log.action':        { en: 'Action' },
    'at.log.connect_pls':   { en: 'Connect to vehicle to load logs' },
    'at.log.dl':            { en: '⬇ Download' },
    
    'at.dyn.connected':     { en: '● Connected' },
    'at.dyn.no_logs':       { en: '● No Logs' },

    'at.geo.select':        { en: 'Image & Log Selection' },
    'at.geo.img_dir':       { en: 'Image Directory' },
    'at.geo.log_file':      { en: 'Log File' },
    'at.geo.browse':        { en: 'Browse' },
    'at.geo.trigger':       { en: 'Camera Trigger Source' },
    'at.geo.offset':        { en: 'Max Time Offset (ms)' },
    'at.geo.cb1':           { en: 'Write tags to EXIF' },
    'at.geo.cb2':           { en: 'Export CSV log' },
    'at.geo.cb3':           { en: 'Overwrite existing tags' },
    'at.geo.start':         { en: 'Start GeoTagging' },
    'at.geo.res':           { en: 'Results' },
    'at.geo.found':         { en: 'Found' },
    'at.geo.tagged':        { en: 'Tagged' },
    'at.geo.skipped':       { en: 'Skipped' },

    'at.con.ready':         { en: 'MAVLink Console — vehicle shell ready' },
    'at.con.send':          { en: 'Send' },
    'at.con.clear':         { en: 'Clear' },
    'at.con.quick':         { en: 'Quick:' },

    'at.ins.start':         { en: '▶ Start' },
    'at.ins.msg':           { en: 'Message' },
    'at.ins.rate':          { en: 'Rate' },
    'at.ins.count':         { en: 'Count' },

    'at.vib.start':         { en: '▶ Start Monitoring' },
    'at.vib.reset':         { en: 'Reset' },
    'at.vib.updates':       { en: 'Updates every 1 s' },
    'at.vib.clip':          { en: 'Clipping' },
    'at.vib.clip_hi':       { en: 'Values above 0 indicate sensor saturation' },
    'at.vib.raw':           { en: 'Raw Vibration Values' },
    'at.vib.imu':           { en: 'IMU' },
    'at.vib.vib_x':         { en: 'Vibe X (m/s²)' },
    'at.vib.vib_y':         { en: 'Vibe Y (m/s²)' },
    'at.vib.vib_z':         { en: 'Vibe Z (m/s²)' },
    'at.vib.status':        { en: 'Status' },

    /* ── Language Selector ── */
    'lang.label': { en: 'Language', ta: 'மொழி', te: 'భాష', hi: 'भाषा', kn: 'ಭಾಷೆ', ml: 'ഭാഷ' },
  };

  /* ═══════════════════════════════════════════════════════════════
     LANGUAGE METADATA
  ═══════════════════════════════════════════════════════════════ */
  const LANGUAGES = [
    { code: 'en', label: 'English',    native: 'English' },
    { code: 'ta', label: 'Tamil',      native: 'தமிழ்' },
    { code: 'te', label: 'Telugu',     native: 'తెలుగు' },
    { code: 'hi', label: 'Hindi',      native: 'हिन्दी' },
    { code: 'kn', label: 'Kannada',    native: 'ಕನ್ನಡ' },
    { code: 'ml', label: 'Malayalam',  native: 'മലയാളം' },
  ];

  /* ═══════════════════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════════════════ */
  let currentLang = localStorage.getItem('tihan_lang') || 'en';

  /* ═══════════════════════════════════════════════════════════════
     CORE: translate one element
  ═══════════════════════════════════════════════════════════════ */
  function t(key) {
    const entry = TRANSLATIONS[key];
    if (!entry) return key;
    return entry[currentLang] || entry['en'] || key;
  }

  /* ═══════════════════════════════════════════════════════════════
     APPLY TRANSLATIONS to all [data-i18n] elements
  ═══════════════════════════════════════════════════════════════ */
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translated = t(key);
      // For inputs/buttons with value, update value; otherwise textContent
      if (el.tagName === 'INPUT' && el.type !== 'range') {
        el.placeholder = translated;
      } else {
        el.textContent = translated;
      }
    });

    // Update html lang attribute
    document.documentElement.lang = currentLang;

    // Dispatch event so other scripts can react
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: currentLang } }));
  }

  /* ═══════════════════════════════════════════════════════════════
     LANGUAGE SELECTOR UI
  ═══════════════════════════════════════════════════════════════ */
  function buildSelector() {
    const wrap = document.getElementById('langSelectorWrap');
    if (!wrap) {
      console.warn('i18n: #langSelectorWrap not found in HTML. Language selector not rendered.');
      return;
    }

    wrap.innerHTML = '';
    wrap.style.cssText = 'position:relative; display:flex; align-items:center; margin-left: 20px;';

    // Combobox button
    const btn = document.createElement('button');
    btn.id = 'langToggleBtn';
    btn.title = 'Select Language / மொழியைத் தேர்ந்தெடு';
    
    // Determine current language label
    const currentLangObj = LANGUAGES.find(l => l.code === currentLang) || LANGUAGES[0];
    const btnLabel = currentLangObj.label;

    btn.innerHTML = `
      <span class="lang-btn-text" style="font-weight:600; margin-right:6px; pointer-events:none;">${btnLabel}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
           stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
           style="pointer-events:none; transition: transform 0.3s;">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>`;
    btn.style.cssText = `
      background: #ffffff;
      border: 1px solid rgba(0,0,0,0.15);
      border-radius: 6px;
      color: #333;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 14px;
      height: 36px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.05);
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      flex-shrink: 0;
      font-size: 13.5px;
      font-family: 'Segoe UI', system-ui, sans-serif;
    `;
    btn.onmouseenter = () => { btn.style.borderColor = 'rgba(230,0,126,0.5)'; };
    btn.onmouseleave = () => { btn.style.borderColor = 'rgba(0,0,0,0.15)'; };

    // Dropdown panel
    const dropdown = document.createElement('div');
    dropdown.id = 'langDropdown';
    dropdown.style.cssText = `
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      background: #1a1a2e;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 12px;
      padding: 8px 0;
      min-width: 160px;
      z-index: 99999;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      display: none;
      animation: langDropIn 0.15s ease-out;
    `;

    // Inject keyframe animation
    if (!document.getElementById('i18n-style')) {
      const style = document.createElement('style');
      style.id = 'i18n-style';
      style.textContent = `
        @keyframes langDropIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .lang-option {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 16px;
          cursor: pointer;
          transition: background 0.15s;
          font-family: 'Segoe UI', system-ui, sans-serif;
          font-size: 13px;
          color: rgba(255,255,255,0.85);
          white-space: nowrap;
        }
        .lang-option:hover { background: rgba(255,255,255,0.08); }
        .lang-option.active {
          background: rgba(230,0,126,0.15);
          color: #fff;
          font-weight: 600;
        }
        .lang-option .lang-native {
          font-size: 12px;
          color: rgba(255,255,255,0.5);
          margin-left: auto;
        }
        .lang-option.active .lang-native { color: rgba(230,0,126,0.9); }
        .lang-check {
          width: 16px; height: 16px;
          border-radius: 50%;
          border: 1.5px solid rgba(255,255,255,0.25);
          display: inline-block;
          flex-shrink: 0;
          position: relative;
        }
        .lang-option.active .lang-check {
          background: #e6007e;
          border-color: #e6007e;
        }
        .lang-option.active .lang-check::after {
          content: '';
          position: absolute;
          top: 2px; left: 5px;
          width: 4px; height: 7px;
          border: 1.5px solid #fff;
          border-top: none; border-left: none;
          transform: rotate(45deg);
        }
        #langToggleBtn.active-lang {
          border-color: #e6007e !important;
          background: rgba(230,0,126,0.15) !important;
          color: #e6007e !important;
        }
      `;
      document.head.appendChild(style);
    }

    // Render language options
    function renderOptions() {
      dropdown.innerHTML = '';
      LANGUAGES.forEach(lang => {
        const opt = document.createElement('div');
        opt.className = 'lang-option' + (lang.code === currentLang ? ' active' : '');
        opt.innerHTML = `
          <span class="lang-check"></span>
          <span class="lang-label">${lang.label}</span>
          <span class="lang-native">${lang.native}</span>
        `;
        opt.addEventListener('click', () => {
          currentLang = lang.code;
          localStorage.setItem('tihan_lang', currentLang);
          applyTranslations();
          
          // Update button text
          const textSpan = btn.querySelector('.lang-btn-text');
          if (textSpan) textSpan.textContent = lang.label;
          
          renderOptions();
          closeDropdown();
        });
        dropdown.appendChild(opt);
      });
    }

    renderOptions();

    // Toggle
    let open = false;
    function openDropdown() {
      open = true;
      dropdown.style.display = 'block';
      btn.classList.add('active-lang');
      const svg = btn.querySelector('svg');
      if (svg) svg.style.transform = 'rotate(180deg)';
    }
    function closeDropdown() {
      open = false;
      dropdown.style.display = 'none';
      btn.classList.remove('active-lang');
      const svg = btn.querySelector('svg');
      if (svg) svg.style.transform = 'rotate(0deg)';
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      open ? closeDropdown() : openDropdown();
    });

    document.addEventListener('click', () => { if (open) closeDropdown(); });
    dropdown.addEventListener('click', e => e.stopPropagation());

    wrap.appendChild(btn);
    wrap.appendChild(dropdown);
  }

  /* ═══════════════════════════════════════════════════════════════
     AUTO-INJECT data-i18n attributes into the DOM
     (so you don't have to manually edit every element)
  ═══════════════════════════════════════════════════════════════ */
  function injectDataAttributes() {
    const map = [
      // Header status badge
      ['#tihanLogo + .status-badge, .status-badge.ready', 'status.ready'],

      // Flight control button labels
      ['#armBtnLabel', 'btn.arm'],
      ['#takeoffBtn .btn-label', 'btn.takeoff'],
      ['#landBtn .btn-label', 'btn.land'],
      ['#rtlBtn .btn-label', 'btn.rtl'],
      ['#flightModeBtn .btn-label', 'btn.mode'],

      // Header indicators
      ['.indicator-item:first-child .indicator-text', 'header.hold'],

      // Dropdown menu
      ['#planFlightBtn .dropdown-btn-label', 'menu.plan'],
      ['#analyzeBtn .dropdown-btn-label', 'menu.analyze'],
      ['#vehicleConfigBtn .dropdown-btn-label', 'menu.config'],
      ['#appSettingsBtn .dropdown-btn-label', 'menu.settings'],

      // Flight Mode Panel
      ['.flight-mode-panel-header > span', 'mode.panel.title'],

      // Weather
      ['.weather-title span', 'weather.title'],
      ['#weatherLoading p', 'weather.loading'],
      ['#weatherErrorMessage', 'weather.error'],
      ['#weatherRetryBtn', 'weather.retry'],
      ['#weatherUpdateTime', 'weather.click'],
      ['.detail-label[id-parent="feelsLike"]', 'weather.feels-like'],

      // Takeoff Modal
      ['.modal-title', 'takeoff.modal.title'],
      ['#modalCancelBtn', 'takeoff.cancel'],
      ['#modalConfirmBtn', 'takeoff.confirm'],
      ['.progress-title', 'takeoff.progress.title'],
      ['#progressStatus', 'takeoff.initiating'],

      // Command Editor
      ['.editor-title span', 'editor.title'],
      ['#emptyWaypointState p', 'editor.no-waypoints'],
      ['#emptyWaypointState small', 'editor.add-hint'],
      ['#backToListBtn', 'editor.back'],
      ['#backToFenceListBtn', 'editor.back'],
      ['#backToRallyListBtn', 'editor.back'],
      ['#saveWaypointBtn', 'editor.save'],
      ['#deleteWaypointBtn', 'editor.delete-wp'],
      ['#saveFenceBtn', 'fence.save'],
      ['#deleteFenceBtn', 'fence.delete'],
      ['#saveRallyBtn', 'rally.save'],
      ['#deleteRallyBtn', 'rally.delete'],
      ['#emptyFenceState p', 'fence.none'],
      ['#emptyFenceState small', 'fence.hint'],
      ['#emptyRallyState p', 'rally.none'],
      ['#emptyRallyState small', 'rally.hint'],

      // Plan Flight Menu labels
      ['#planFlightMenuStrip .plan-menu-dropdown:nth-child(1) .plan-menu-label', 'plan.file'],
      ['#planFlightMenuStrip .plan-menu-dropdown:nth-child(2) .plan-menu-label', 'plan.takeoff'],
      ['#planFlightMenuStrip .plan-menu-dropdown:nth-child(3) .plan-menu-label', 'plan.waypoint'],
      ['#planFlightMenuStrip .plan-menu-dropdown:nth-child(4) .plan-menu-label', 'plan.polygon'],
      ['#planFlightMenuStrip .plan-menu-dropdown:nth-child(5) .plan-menu-label', 'plan.return'],
      ['#planFlightMenuStrip .plan-menu-dropdown:nth-child(6) .plan-menu-label', 'plan.center'],

      // Vehicle Config
      ['.vc-title-text', 'vc.title'],
      ['.vc-drone-title', 'vc.drone-type'],
      ['#vcRefreshPortsBtn', 'vc.refresh'],

      // Weather detail labels (match by order)
      ['.weather-details-grid .weather-detail-item:nth-child(1) .detail-label', 'weather.feels-like'],
      ['.weather-details-grid .weather-detail-item:nth-child(2) .detail-label', 'weather.humidity'],
      ['.weather-details-grid .weather-detail-item:nth-child(3) .detail-label', 'weather.wind'],
      ['.weather-details-grid .weather-detail-item:nth-child(4) .detail-label', 'weather.pressure'],
      ['.weather-details-grid .weather-detail-item:nth-child(5) .detail-label', 'weather.visibility'],
      ['.weather-details-grid .weather-detail-item:nth-child(6) .detail-label', 'weather.clouds'],
    ];

    map.forEach(([selector, key]) => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          if (!el.hasAttribute('data-i18n')) {
            el.setAttribute('data-i18n', key);
          }
        });
      } catch (e) { /* invalid selector — skip */ }
    });

    // Plan flight menu links
    const planLinks = {
      'new-mission': 'plan.new-mission',
      'open-mission': 'plan.open-mission',
      'save-mission': 'plan.save-mission',
      'write-to-drone': 'plan.write-drone',
      'takeoff-here': 'plan.takeoff-here',
      'set-home-position': 'plan.set-home',
      'clear-home': 'plan.clear-home',
      'add-waypoint': 'plan.add-waypoint',
      'send-markers': 'plan.send-markers',
      'delete-waypoint': 'plan.delete-waypoint',
      'clear-all': 'plan.clear-all',
      'draw-polygon': 'plan.draw-polygon',
      'edit-polygon': 'plan.edit-polygon',
      'survey-settings': 'plan.survey-settings',
      'send-to-drone': 'plan.send-drone',
      'clear-polygon': 'plan.clear-polygon',
      'return-to-launch': 'plan.rtl',
      'land-here': 'plan.land-here',
      'center-mission': 'plan.center-mission',
      'center-vehicle': 'plan.center-vehicle',
      'center-home': 'plan.center-home',
    };

    document.querySelectorAll('[data-action]').forEach(el => {
      const action = el.getAttribute('data-action');
      if (planLinks[action] && !el.hasAttribute('data-i18n')) {
        el.setAttribute('data-i18n', planLinks[action]);
      }
    });

    // Mode panel items
    const modeMap = {
      'Stabilize': 'mode.stabilize',
      'Acro': 'mode.acro',
      'Altitude Hold': 'mode.althold',
      'Auto': 'mode.auto',
      'Guided': 'mode.guided',
      'Loiter': 'mode.loiter',
      'RTL': 'mode.rtl',
      'Circle': 'mode.circle',
      'Land': 'mode.land',
      'Smart RTL': 'mode.smartrtl',
      'Drift': 'mode.drift',
      'Sport': 'mode.sport',
      'Position': 'mode.position',
      'Follow Me': 'mode.followme',
    };

    document.querySelectorAll('.mode-item').forEach(item => {
      const nameEl = item.querySelector('.mode-name');
      const tagEl = item.querySelector('.mode-tag');
      const modeName = item.getAttribute('data-mode');
      if (nameEl && modeMap[modeName] && !nameEl.hasAttribute('data-i18n')) {
        nameEl.setAttribute('data-i18n', modeMap[modeName]);
      }
      if (tagEl) {
        const cls = Array.from(tagEl.classList).find(c => ['basic','expert','auto','gps'].includes(c));
        if (cls && !tagEl.hasAttribute('data-i18n')) {
          tagEl.setAttribute('data-i18n', 'mode.tag.' + cls);
        }
      }
    });

    // Takeoff altitude & speed labels
    document.querySelectorAll('.input-label').forEach(el => {
      if (el.textContent.trim() === 'Target Altitude') el.setAttribute('data-i18n', 'takeoff.altitude.label');
      if (el.textContent.trim() === 'Climb Speed') el.setAttribute('data-i18n', 'takeoff.speed.label');
    });

    // Command editor form labels
    document.querySelectorAll('#waypointDetailsPanel .form-group label').forEach(label => {
      const text = label.textContent.trim();
      const labelMap = {
        'Waypoint ID': 'editor.wp-id',
        'Latitude': 'editor.latitude',
        'Longitude': 'editor.longitude',
        'Altitude (meters)': 'editor.altitude',
        'Type': 'editor.type',
      };
      if (labelMap[text]) label.setAttribute('data-i18n', labelMap[text]);
    });

    document.querySelectorAll('#fenceDetailsPanel .form-group label').forEach(label => {
      const text = label.textContent.trim();
      if (text === 'Fence ID') label.setAttribute('data-i18n', 'fence.id');
      if (text === 'Fence Type') label.setAttribute('data-i18n', 'fence.type');
      if (text === 'Points') label.setAttribute('data-i18n', 'fence.points');
    });

    document.querySelectorAll('#rallyDetailsPanel .form-group label').forEach(label => {
      const text = label.textContent.trim();
      if (text === 'Rally Point ID') label.setAttribute('data-i18n', 'rally.id');
      if (text === 'Latitude') label.setAttribute('data-i18n', 'editor.latitude');
      if (text === 'Longitude') label.setAttribute('data-i18n', 'editor.longitude');
      if (text === 'Altitude (meters)') label.setAttribute('data-i18n', 'editor.altitude');
    });

    // VC sections
    document.querySelectorAll('.vc-section-header').forEach(el => {
      if (el.textContent.includes('Serial Port')) el.setAttribute('data-i18n', 'vc.serial-port');
      if (el.textContent.includes('Flashing Log')) el.setAttribute('data-i18n', 'vc.flash-log');
    });
    document.querySelectorAll('.vc-progress-label').forEach(el => {
      if (el.textContent.includes('Erase')) el.setAttribute('data-i18n', 'vc.erase-progress');
      if (el.textContent.includes('Write')) el.setAttribute('data-i18n', 'vc.write-progress');
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     EXPOSE public API
  ═══════════════════════════════════════════════════════════════ */
  window.i18n = {
    t,
    setLang: (code) => {
      if (LANGUAGES.find(l => l.code === code)) {
        currentLang = code;
        localStorage.setItem('tihan_lang', code);
        applyTranslations();
      }
    },
    getLang: () => currentLang,
    TRANSLATIONS,
    LANGUAGES,
  };

  /* ═══════════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════════ */
  function init() {
    injectDataAttributes();
    buildSelector();
    applyTranslations();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already ready (script loaded at end of body)
    init();
  }

})();
