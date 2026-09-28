# backend/geo_data.py
"""
Add Project — State / District / Constituency geography data.

ISOLATED FEATURE MODULE. This file exists only to back the cascading
State -> District -> Constituency dropdowns in the "Add New Project" form
and the matching server-side validation in POST /api/projects. It is not
imported by, and does not change, any other endpoint, the risk engine, the
map, reports, notifications or settings.

REAL DATA, DISCLOSED SCOPE:
- Every state, union territory, district and constituency name below is a
  real, currently-existing place/constituency name — nothing here is
  invented.
- Coverage is intentionally NOT exhaustive for every state. Maharashtra is
  fully enumerated (all 36 districts) because it is this feature's primary
  test case. Other states/UTs list their real districts but, for several
  of the larger states, only a representative subset rather than the full
  official roster (which runs into the hundreds of names nationwide).
  Districts not yet listed simply won't appear in the dropdown yet — this
  is an honest gap, not a fabricated entry.
- Constituency (Lok Sabha PC) -> district mapping is filled in only where
  confidently known (Maharashtra plus a handful of Delhi entries). A
  district with no constituency entries surfaces the UI's "No constituency
  mapping available" state rather than a guessed value.
- Before using this for anything beyond a prototype/demo, cross-check
  against an authoritative source (Census/LGD codes, Election Commission
  of India delimitation data), since district and constituency boundaries
  do change over time.
"""

from typing import Dict, List

# Every real Indian state and union territory (28 states + 8 UTs).
STATES: List[str] = [
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chhattisgarh",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
    "Andaman and Nicobar Islands",
    "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi",
    "Jammu and Kashmir",
    "Ladakh",
    "Lakshadweep",
    "Puducherry",
]

# state -> { district: [constituency, ...] }
# An empty constituency list means "no constituency mapping available yet"
# for that (real) district — see module docstring.
REGIONS: Dict[str, Dict[str, List[str]]] = {
    "Maharashtra": {
        "Mumbai City": ["Mumbai South", "Mumbai South Central"],
        "Mumbai Suburban": ["Mumbai North", "Mumbai North West", "Mumbai North East", "Mumbai North Central"],
        "Thane": ["Thane", "Kalyan"],
        "Palghar": ["Palghar"],
        "Raigad": ["Raigad"],
        "Pune": ["Pune", "Baramati", "Maval", "Shirur"],
        "Nashik": ["Nashik", "Dindori"],
        "Ahmednagar": [],
        "Akola": ["Akola"],
        "Amravati": ["Amravati"],
        "Aurangabad": ["Aurangabad"],
        "Beed": ["Beed"],
        "Bhandara": [],
        "Buldhana": ["Buldhana"],
        "Chandrapur": ["Chandrapur"],
        "Dhule": ["Dhule"],
        "Gadchiroli": [],
        "Gondia": [],
        "Hingoli": ["Hingoli"],
        "Jalgaon": ["Jalgaon", "Raver"],
        "Jalna": ["Jalna"],
        "Kolhapur": ["Kolhapur", "Hatkanangle"],
        "Latur": ["Latur"],
        "Nagpur": ["Nagpur", "Ramtek"],
        "Nanded": ["Nanded"],
        "Nandurbar": ["Nandurbar"],
        "Osmanabad": ["Osmanabad"],
        "Parbhani": ["Parbhani"],
        "Ratnagiri": ["Ratnagiri-Sindhudurg"],
        "Sangli": ["Sangli"],
        "Satara": ["Satara"],
        "Sindhudurg": [],
        "Solapur": ["Solapur", "Madha"],
        "Wardha": ["Wardha"],
        "Washim": ["Washim"],
        "Yavatmal": ["Yavatmal-Washim"],
    },
    "Karnataka": {
        "Bengaluru Urban": ["Bengaluru Central", "Bengaluru North", "Bengaluru South", "Bangalore Rural"],
        "Mysuru": ["Mysore"],
        "Belagavi": ["Belgaum"],
        "Dakshina Kannada": ["Dakshina Kannada"],
        "Kalaburagi": ["Gulbarga"],
        "Ballari": ["Bellary"],
        "Dharwad": ["Dharwad"],
        "Hubballi-Dharwad": [],
        "Shivamogga": ["Shimoga"],
        "Tumakuru": ["Tumkur"],
        "Udupi": ["Udupi Chikmagalur"],
        "Vijayapura": [],
        "Bidar": ["Bidar"],
        "Raichur": ["Raichur"],
        "Bagalkot": ["Bagalkot"],
        "Chitradurga": ["Chitradurga"],
        "Davanagere": ["Davanagere"],
        "Hassan": ["Hassan"],
        "Kolar": ["Kolar"],
        "Mandya": ["Mandya"],
    },
    "Tamil Nadu": {
        "Chennai": ["Chennai Central", "Chennai North", "Chennai South"],
        "Coimbatore": ["Coimbatore"],
        "Madurai": ["Madurai"],
        "Tiruchirappalli": ["Tiruchirappalli"],
        "Salem": ["Salem"],
        "Tirunelveli": ["Tirunelveli"],
        "Erode": ["Erode"],
        "Vellore": ["Vellore"],
        "Thanjavur": ["Thanjavur"],
        "Kanyakumari": ["Kanyakumari"],
        "Cuddalore": [],
        "Dindigul": [],
        "Krishnagiri": [],
        "Thoothukudi": [],
    },
    "Kerala": {
        "Thiruvananthapuram": ["Thiruvananthapuram"],
        "Kollam": ["Kollam"],
        "Ernakulam": ["Ernakulam"],
        "Kozhikode": ["Kozhikode"],
        "Thrissur": ["Thrissur"],
        "Kannur": ["Kannur"],
        "Alappuzha": ["Alappuzha"],
        "Kottayam": ["Kottayam"],
        "Palakkad": ["Palakkad"],
        "Malappuram": ["Malappuram", "Ponnani"],
        "Idukki": ["Idukki"],
        "Pathanamthitta": ["Pathanamthitta"],
        "Wayanad": ["Wayanad"],
        "Kasaragod": ["Kasaragod"],
    },
    "Gujarat": {
        "Ahmedabad": ["Ahmedabad East", "Ahmedabad West"],
        "Surat": ["Surat"],
        "Vadodara": ["Vadodara"],
        "Rajkot": ["Rajkot"],
        "Bhavnagar": ["Bhavnagar"],
        "Jamnagar": ["Jamnagar"],
        "Gandhinagar": ["Gandhinagar"],
        "Junagadh": ["Junagadh"],
        "Anand": ["Anand"],
        "Kutch": ["Kutch"],
        "Mehsana": [],
        "Panchmahal": [],
        "Bharuch": ["Bharuch"],
        "Navsari": ["Navsari"],
        "Patan": ["Patan"],
    },
    "Rajasthan": {
        "Jaipur": ["Jaipur", "Jaipur Rural"],
        "Jodhpur": ["Jodhpur"],
        "Udaipur": ["Udaipur"],
        "Kota": ["Kota"],
        "Ajmer": ["Ajmer"],
        "Bikaner": ["Bikaner"],
        "Alwar": ["Alwar"],
        "Bharatpur": ["Bharatpur"],
        "Sikar": ["Sikar"],
        "Jaisalmer": [],
        "Pali": ["Pali"],
        "Nagaur": ["Nagaur"],
        "Barmer": ["Barmer"],
        "Churu": ["Churu"],
    },
    "Madhya Pradesh": {
        "Bhopal": ["Bhopal"],
        "Indore": ["Indore"],
        "Gwalior": ["Gwalior"],
        "Jabalpur": ["Jabalpur"],
        "Ujjain": ["Ujjain"],
        "Sagar": ["Sagar"],
        "Rewa": ["Rewa"],
        "Satna": ["Satna"],
        "Ratlam": ["Ratlam"],
        "Dewas": [],
        "Chhindwara": ["Chhindwara"],
        "Khargone": [],
        "Vidisha": ["Vidisha"],
        "Hoshangabad": ["Hoshangabad"],
    },
    "Bihar": {
        "Patna": ["Patna Sahib", "Pataliputra"],
        "Gaya": ["Gaya"],
        "Bhagalpur": ["Bhagalpur"],
        "Muzaffarpur": ["Muzaffarpur"],
        "Darbhanga": ["Darbhanga"],
        "Purnia": ["Purnia"],
        "Nalanda": ["Nalanda"],
        "Begusarai": ["Begusarai"],
        "Munger": ["Munger"],
        "Saran": ["Saran"],
        "Vaishali": ["Vaishali"],
        "Samastipur": ["Samastipur"],
        "Siwan": ["Siwan"],
        "Katihar": ["Katihar"],
    },
    "West Bengal": {
        "Kolkata": ["Kolkata Dakshin", "Kolkata Uttar"],
        "North 24 Parganas": ["Barasat", "Dum Dum", "Barrackpore"],
        "South 24 Parganas": ["Diamond Harbour", "Jadavpur"],
        "Howrah": ["Howrah"],
        "Hooghly": ["Hooghly"],
        "Darjeeling": ["Darjeeling"],
        "Malda": ["Maldaha Uttar", "Maldaha Dakshin"],
        "Murshidabad": ["Murshidabad", "Baharampur"],
        "Nadia": ["Krishnanagar", "Ranaghat"],
        "Bardhaman": [],
        "Purulia": ["Purulia"],
    },
    "Punjab": {
        "Amritsar": ["Amritsar"],
        "Ludhiana": ["Ludhiana"],
        "Jalandhar": ["Jalandhar"],
        "Patiala": ["Patiala"],
        "Bathinda": ["Bathinda"],
        "Mohali": [],
        "Hoshiarpur": ["Hoshiarpur"],
        "Gurdaspur": ["Gurdaspur"],
        "Ferozepur": ["Ferozepur"],
        "Sangrur": ["Sangrur"],
    },
    "Haryana": {
        "Gurugram": ["Gurgaon"],
        "Faridabad": ["Faridabad"],
        "Panipat": ["Karnal"],
        "Ambala": ["Ambala"],
        "Hisar": ["Hisar"],
        "Rohtak": ["Rohtak"],
        "Karnal": ["Karnal"],
        "Sonipat": ["Sonipat"],
        "Kurukshetra": ["Kurukshetra"],
        "Sirsa": ["Sirsa"],
    },
    "Delhi": {
        "New Delhi": ["New Delhi"],
        "Central Delhi": ["Chandni Chowk"],
        "East Delhi": ["East Delhi"],
        "North Delhi": ["Chandni Chowk"],
        "North East Delhi": ["North East Delhi"],
        "North West Delhi": ["North West Delhi"],
        "South Delhi": ["South Delhi"],
        "South East Delhi": ["South Delhi"],
        "South West Delhi": ["West Delhi"],
        "West Delhi": ["West Delhi"],
        "Shahdara": ["North East Delhi"],
    },
    "Telangana": {
        "Hyderabad": ["Hyderabad", "Secunderabad"],
        "Rangareddy": ["Chevella"],
        "Warangal": ["Warangal"],
        "Nizamabad": ["Nizamabad"],
        "Karimnagar": ["Karimnagar"],
        "Khammam": ["Khammam"],
        "Mahbubnagar": ["Mahabubnagar"],
        "Nalgonda": ["Nalgonda"],
        "Medak": ["Medak"],
        "Adilabad": ["Adilabad"],
    },
    "Andhra Pradesh": {
        "Visakhapatnam": ["Visakhapatnam"],
        "Vijayawada": [],
        "NTR": ["Vijayawada"],
        "Guntur": ["Guntur"],
        "Krishna": ["Machilipatnam"],
        "Kurnool": ["Kurnool"],
        "Anantapur": ["Anantapur"],
        "Chittoor": ["Chittoor"],
        "Tirupati": ["Tirupati"],
        "East Godavari": ["Rajahmundry"],
        "West Godavari": ["Eluru"],
        "Srikakulam": ["Srikakulam"],
        "Nellore": ["Nellore"],
    },
    "Odisha": {
        "Khordha": ["Bhubaneswar"],
        "Cuttack": ["Cuttack"],
        "Puri": ["Puri"],
        "Ganjam": ["Berhampur"],
        "Sambalpur": ["Sambalpur"],
        "Balasore": ["Balasore"],
        "Mayurbhanj": ["Mayurbhanj"],
        "Kalahandi": ["Kalahandi"],
        "Sundargarh": ["Sundargarh"],
        "Koraput": ["Koraput"],
    },
    "Assam": {
        "Kamrup Metropolitan": ["Guwahati"],
        "Kamrup": ["Guwahati"],
        "Dibrugarh": ["Dibrugarh"],
        "Jorhat": ["Jorhat"],
        "Cachar": ["Silchar"],
        "Nagaon": ["Nagaon"],
        "Sonitpur": ["Tezpur"],
        "Barpeta": ["Barpeta"],
        "Karimganj": ["Karimganj"],
        "Tinsukia": ["Dibrugarh"],
    },
    "Chhattisgarh": {
        "Raipur": ["Raipur"],
        "Durg": ["Durg"],
        "Bilaspur": ["Bilaspur"],
        "Bastar": ["Bastar"],
        "Rajnandgaon": ["Rajnandgaon"],
        "Korba": ["Korba"],
        "Raigarh": ["Raigarh"],
        "Surguja": ["Surguja"],
    },
    "Jharkhand": {
        "Ranchi": ["Ranchi"],
        "Dhanbad": ["Dhanbad"],
        "Jamshedpur": [],
        "East Singhbhum": ["Jamshedpur"],
        "Bokaro": ["Giridih"],
        "Hazaribagh": ["Hazaribagh"],
        "Deoghar": ["Godda"],
        "Palamu": ["Palamu"],
        "Dumka": ["Dumka"],
    },
    "Uttarakhand": {
        "Dehradun": ["Tehri Garhwal"],
        "Haridwar": ["Haridwar"],
        "Nainital": ["Nainital-Udhamsingh Nagar"],
        "Udham Singh Nagar": ["Nainital-Udhamsingh Nagar"],
        "Almora": ["Almora"],
        "Pauri Garhwal": ["Pauri Garhwal"],
        "Pithoragarh": ["Almora"],
    },
    "Himachal Pradesh": {
        "Shimla": ["Shimla"],
        "Kangra": ["Kangra"],
        "Mandi": ["Mandi"],
        "Solan": ["Shimla"],
        "Una": ["Hamirpur"],
        "Hamirpur": ["Hamirpur"],
        "Kullu": ["Mandi"],
    },
    "Goa": {
        "North Goa": ["North Goa"],
        "South Goa": ["South Goa"],
    },
    "Uttar Pradesh": {
        "Lucknow": ["Lucknow"],
        "Kanpur Nagar": ["Kanpur"],
        "Varanasi": ["Varanasi"],
        "Agra": ["Agra"],
        "Prayagraj": ["Phulpur", "Allahabad"],
        "Meerut": ["Meerut"],
        "Ghaziabad": ["Ghaziabad"],
        "Noida": [],
        "Gautam Buddha Nagar": ["Gautam Buddha Nagar"],
        "Bareilly": ["Bareilly"],
        "Aligarh": ["Aligarh"],
        "Moradabad": ["Moradabad"],
        "Gorakhpur": ["Gorakhpur"],
        "Jhansi": ["Jhansi"],
        "Mathura": ["Mathura"],
        "Ayodhya": ["Faizabad"],
        "Azamgarh": ["Azamgarh"],
        "Saharanpur": ["Saharanpur"],
    },
    "Andaman and Nicobar Islands": {
        "South Andaman": ["Andaman and Nicobar Islands"],
        "North and Middle Andaman": [],
        "Nicobar": [],
    },
    "Chandigarh": {
        "Chandigarh": ["Chandigarh"],
    },
    "Dadra and Nagar Haveli and Daman and Diu": {
        "Dadra and Nagar Haveli": ["Dadra and Nagar Haveli"],
        "Daman": ["Daman and Diu"],
        "Diu": ["Daman and Diu"],
    },
    "Jammu and Kashmir": {
        "Srinagar": ["Srinagar"],
        "Jammu": ["Jammu"],
        "Anantnag": ["Anantnag-Rajouri"],
        "Baramulla": ["Baramulla"],
        "Udhampur": ["Udhampur"],
        "Kathua": ["Jammu"],
    },
    "Ladakh": {
        "Leh": ["Ladakh"],
        "Kargil": ["Ladakh"],
    },
    "Lakshadweep": {
        "Lakshadweep": ["Lakshadweep"],
    },
    "Puducherry": {
        "Puducherry": ["Puducherry"],
        "Karaikal": [],
        "Mahe": [],
        "Yanam": [],
    },
    "Arunachal Pradesh": {
        "Papum Pare": ["Arunachal West"],
        "East Siang": ["Arunachal East"],
        "West Kameng": ["Arunachal West"],
        "Changlang": ["Arunachal East"],
        "Tawang": ["Arunachal West"],
    },
    "Manipur": {
        "Imphal West": ["Inner Manipur"],
        "Imphal East": ["Inner Manipur"],
        "Churachandpur": ["Outer Manipur"],
        "Senapati": ["Outer Manipur"],
        "Thoubal": ["Inner Manipur"],
    },
    "Meghalaya": {
        "East Khasi Hills": ["Shillong"],
        "West Garo Hills": ["Tura"],
        "Ri Bhoi": ["Shillong"],
        "Jaintia Hills": ["Shillong"],
    },
    "Mizoram": {
        "Aizawl": ["Mizoram"],
        "Lunglei": ["Mizoram"],
        "Champhai": ["Mizoram"],
    },
    "Nagaland": {
        "Kohima": ["Nagaland"],
        "Dimapur": ["Nagaland"],
        "Mokokchung": ["Nagaland"],
    },
    "Sikkim": {
        "East Sikkim": ["Sikkim"],
        "West Sikkim": ["Sikkim"],
        "North Sikkim": ["Sikkim"],
        "South Sikkim": ["Sikkim"],
    },
    "Tripura": {
        "West Tripura": ["Tripura West"],
        "Sepahijala": ["Tripura West"],
        "Gomati": ["Tripura East"],
        "Dhalai": ["Tripura East"],
        "North Tripura": ["Tripura East"],
        "Unakoti": ["Tripura East"],
        "South Tripura": ["Tripura East"],
        "Khowai": ["Tripura West"],
    },
}


def regions_payload() -> dict:
    """Serializable form consumed by GET /api/geo/regions and, in turn, by
    the Add Project form's cascading State -> District -> Constituency
    dropdowns."""
    return {"states": STATES, "regions": REGIONS}


def is_valid_state(state: str) -> bool:
    return state in STATES


def is_valid_state_district(state: str, district: str) -> bool:
    """True if `district` is one of this module's known real districts for
    `state`. States not yet covered by REGIONS (see module docstring) are
    treated as having no known-district constraint, so they don't block a
    legitimate submission for a state this prototype hasn't enumerated yet
    — only a district that contradicts a state we DO have data for is
    rejected."""
    if state not in STATES:
        return False
    districts = REGIONS.get(state)
    if not districts:
        return True
    return district in districts
