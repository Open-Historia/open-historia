/*! Open Historia — political parties © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Politics tab of the Stats pane: a polity's government and its parties (or,
// where there are no parties, its factions), kept per polity in world.politics.
// Written by the politicalLandscape task (AI/gameplay.js assessPoliticalLandscape)
// when the player asks for it, then moved by turns through impacts.partyOps.
//
// The ten ideologies and their subideologies are the Kaiserreich (KX) set, names
// only, taken from the tables of contents of the KX ideology documents. A
// subideology is only meaningful under its ideology: several names (Kleptocracy,
// Agrarianism, Tridemism...) sit under more than one.

export const IDEOLOGIES = [
  { id: "totalism", name: "Totalism", colour: "#8b0000", subideologies: [
    "Afrofuturism", "Agrarian Socialism", "Anarcho-Bolshevism", "Anarcho-Communism", "Arab Ihya",
    "Authenticité", "Autocratic Socialism", "Baha’i Universalism", "Bordigism", "Bourguibism",
    "British Maximism", "Broad Communism", "Bukharinism", "Burnhamite Thought", "Cargo Cult",
    "Christian Communism", "Clientelism", "Communism", "Comrades of the Coast", "Council Communism",
    "Corn Communism", "Crab Communalism", "Developing Socialism", "Egoism", "European Pan-Africanism",
    "Evidentist Technocracy", "Fitzhughism", "Georgian Socialism", "Haeusserbund",
    "Hardliner Bolshevism", "Heat Miserism", "Hoxhaism", "Illegalism", "Islamic Socialism",
    "Italian Left Futurism", "Jangali Thought", "Kadroism", "Kleptocracy", "Kritarchy",
    "Left Boulangism", "Left Internationalism", "Left Lovecraftism", "Left Nationalism",
    "Left Pan-Africanism", "Left Paneuropeanism", "Left Roerichism", "Left-Townerism", "Lindholmism",
    "Lovestoneism", "Machiavellian Socialism", "Maciànismo", "Mafioso Socialism", "Mariáteguismo",
    "Market Socialism", "Marxism-Careyism", "Massimalismo", "Matswanism", "Maximato",
    "Maximist Ruralism", "Mexicayotlism", "Militant Anarcho-Pastoralism", "Militant Atheism",
    "Militant Feminism", "Molotovism", "National Communism", "National Jacobinism",
    "National Syndicalism", "Négritude", "Néo-Socialisme", "Ngara Modekngei", "Nkrumaism", "Noirisme",
    "Obamaism", "Pan-Somalism", "Peasant Charterism", "Popular Communism", "Red Cossack Dictatorship",
    "Red Jacobinism", "Red Junta", "Red Social Credit", "Reformed Charter Totalism",
    "Revolutionary Savinkovism", "Revolutionary Ustaše", "Richytskyi Thought", "Right Pan-Africanism",
    "Scarlet Esotericism", "Social-Futurism", "Socialist Feminism", "Socialist Security State",
    "Social Monarchism", "Sorelianism", "Surrealism", "Technocracy", "Technocratic Socialism",
    "Totalism", "Tridemism", "Ultra-Hoxhaism", "Völkisch Communitarianism", "Vorticism",
    "Wäisi Movement", "William Foster Thought", "Zinovievism"
  ] },
  { id: "syndicalism", name: "Syndicalism", colour: "#e0262b", subideologies: [
    "Aboriginal Garveyism", "African Syndicalism", "Afrofuturism", "Agrarian Syndicalism",
    "Anarcha-Feminism", "Anarchism", "Anarchist Synthesis", "Anarcho-Abertzalism", "Anarcho-Communism",
    "Anarcho-Syndicalism", "Anthropophagic Movement", "Baha’i Universalism", "Broad Communism",
    "Buddhist Socialism", "Bukharinism", "Centralized Syndicalism", "Christian Syndicalism",
    "Clientelism", "Comrades of the Coast", "Council Communism", "Cowboy Communalism", "De Leonism",
    "Democratic Syndicalism", "Developing Socialism", "Eco-Syndicalism", "European Pan-Africanism",
    "Fascism", "Gandhism", "Guild Socialism", "Hardliner Bolshevism", "Illegalism",
    "Individualist Anarchism", "Islamic Socialism", "Italian Left Futurism", "Kleptocracy",
    "Kotahitanga", "Laskian Syndicalism", "Left Georgism", "Left Internationalism", "Left Nationalism",
    "Left Pan-Africanism", "Left Peronism", "Left Roerichism", "Liberalized Syndicalism",
    "Liberal Socialism", "Macedonian Federalism", "Mafioso Socialism", "Mariáteguismo", "Matswanisme",
    "Mexicayotlism", "Modernismo Nicaragüense", "Municipal Socialism", "Mutualism", "Mystical Anarchism",
    "National Jacobinism", "National Syndicalism", "Négritude", "Ngara Modekngei", "Nkrumaism",
    "Noirisme", "Pan-Celticism", "Platformism", "Police State", "Popular Communism",
    "Possibilist Libertarianism", "Radical Progressivism", "Red Junta", "Reformed Charter Totalism",
    "Reformed Sorelianism", "Revolutionary Bolivarianism", "Sandinismo", "Scarlet Esotericism",
    "Sindikatismo", "Socialist Feminism", "Spiritualism", "Surrealism", "Syndicalism",
    "Technocratic Socialism", "Teetotalism", "Tridemism", "Utopian Technocracy", "Yellow Syndicalism"
  ] },
  { id: "radicalSocialism", name: "Radical Socialism", colour: "#f0506e", subideologies: [
    "Agrarian Socialism", "Anarcha-Feminism", "Anarchism", "Anarchist Synthesis", "Anarcho-Communism",
    "Anarcho-Syndicalism", "Apartheid Socialism", "Austromarxism", "Baha’i Universalism", "Bellamyism",
    "Broad Communism", "Buddhist Socialism", "Bukharinism", "Caodaism", "Cargo Cult",
    "Christian Anarchism", "Christian Socialism", "Christian Syndicalism", "Clientelism", "Coconutism",
    "Comrades of the Coast", "Council Communism", "Cowboy Communalism", "Crab Communalism", "De Leonism",
    "Developing Socialism", "Eco-Anarchism", "Eco-Socialism", "Egoism", "European Pan-Africanism",
    "Fascism", "Francoism", "Freiwirtschaft", "Frontier Socialism", "Gandhism", "Guild Socialism",
    "Hašekism", "Hoahaoism", "Humanistic Capitalism", "Illegalism", "Indigenous Communitarianism",
    "Individualist Anarchism", "Islamic Socialism", "Italian Left Futurism", "Jeffersonianism",
    "Jermanism", "Kimbanguism", "Kleptocracy", "Kritarchy", "Laborismo Esperantista", "Left Carlism",
    "Left Eurasianism", "Left Georgism", "Left Internationalism", "Left Lovecraftism",
    "Left Nationalism", "Left Pan-Africanism", "Left Paneuropeanism", "Left Peronism", "Left Roerichism",
    "Liberal Socialism", "Machiavellian Socialism", "Maciànismo", "Mafioso Socialism", "Mariáteguismo",
    "Market-Leninism", "Market Socialism", "Matswanisme", "Mexicayotlism", "Moderate Obamaism",
    "Moderate Socialism", "Monarcho-Socialism", "Municipal Socialism", "Mutualism", "Narodism",
    "National Communism", "Négritude", "Neo-Malthusianism", "Nkrumaism", "Noirisme", "Pan-Asianism",
    "Pan-Celticism", "Pan-Somalism", "Paternal Socialism", "Platformism", "Popular Communism",
    "Popular Patriotism", "Quaker Socialism", "Radical Progressivism", "Radical Socialism",
    "Rangga Theory", "Red Cossack Dictatorship", "Red Junta", "Red Social Credit", "Revisionist Marxism",
    "Revolutionary Bolivarianism", "Saavedrista Republicanism", "Sandinismo", "Scarlet Esotericism",
    "Social Hiveism", "Socialist Colonial Government", "Socialist Feminism", "Soltangalievism",
    "Surrealism", "Syndicalism", "Tridemism", "Ujamaa", "Utopian Technocracy", "Vardamanism",
    "Yellow Socialism", "Zhdanovism"
  ] },
  { id: "socialDemocracy", name: "Social Democracy", colour: "#f28cb1", subideologies: [
    "Agrarianism", "Anthroposophy", "Apartheid Socialism", "Austromarxism",
    "Authoritarian Social Democracy", "Baha’i Universalism", "Batllismo", "Bonapartism",
    "Broad Paneuropeanism", "Buddhist Socialism", "Burkhanism", "Calderonismo", "Centrism",
    "Chinese Federalism", "Christian Anarchism", "Christian Democracy", "Christian Socialism",
    "Clientelism", "Coconutism", "Concretismo", "Cossack Democracy", "Cowboy Communalism",
    "Democratic Hussitism", "Democratic Socialism", "Developing Socialism", "Dixiecrat", "Eco-Socialism",
    "European Pan-Africanism", "Fascism", "Figuerismo", "Gandhism", "Guild Socialism",
    "Humanistic Capitalism", "Illegalism", "Indigenous Communitarianism", "Individualist Anarchism",
    "Integral Federalism", "Islamic Democracy", "Islamic Socialism", "Jadidism", "Janismo",
    "Jeffersonianism", "Jermanism", "Kimbanguism", "Kleptocracy", "Langism", "Left Georgism",
    "Left Nationalism", "Left Pan-Africanism", "Left Roerichism", "Lenschian Tendency", "Lerrouxismo",
    "Liberal Internationalism", "Liberalized Criminal State", "Liberalized Syndicalism",
    "Liberal Sandinismo", "Liberal Socialism", "Longism", "Macedonian Federalism", "Maciànismo",
    "Maréchaliste Democracy", "Market Socialism", "Mercenary Democracy", "Mexicayotlism", "Milazzismo",
    "Municipalism", "Narodism", "National Progressivism", "Négritude", "Neo-Santaism", "Nordic Model",
    "Oligarchism", "Pan-Somalism", "Paternal Socialism", "Pharaonism", "Popular Patriotism",
    "Popular Vlasovism", "Populist Dixiecrats", "Progressive Conservatism", "Progressive Democracy",
    "Radical Progressivism", "Red Social Credit", "Reformed Belgicism", "Republican Pan-Africanism",
    "Republican Tribal Councilism", "Revisionist Marxism", "Santaism", "Sardism", "Scandinavism",
    "Scarlet Esotericism", "Social Colonial Government", "Social Democracy", "Social Democratic Junta",
    "Socialist Feminism", "Socialist Warlordism", "Social Monarchism", "Spiritualism",
    "Spiritual Socialism", "Syndicalist-Aligned Social Democracy", "Teetotalism", "Tridemism",
    "True Whiggism", "Utopian Technocracy", "Venizelism", "Wäisi Movement"
  ] },
  { id: "socialLiberalism", name: "Social Liberalism", colour: "#f2c94c", subideologies: [
    "Aboriginal Garveyism", "Agrarianism", "Authoritarian Liberalism", "Bernardismo", "Blasquismo",
    "Burkhanism", "Centrism", "Chinese Federalism", "Christian Democracy", "Christian Socialism",
    "Classical Liberalism", "Clientelism", "Community Movement", "Cossack Democracy", "Cultural Mannism",
    "Dixiecrat", "Esotericism", "European Pan-Africanism", "Gandhism", "Humanistic Capitalism",
    "Indigenous Communitarianism", "Islamic Democracy", "Jacksonianism", "Jadidism", "Jeffersonianism",
    "Jindyworobak", "Kalergite Paneuropeanism", "Kerenskyism", "Kimbanguism", "Kotahitanga", "Kritarchy",
    "Laurentism", "Left Georgism", "Lerrouxismo", "Liberal Colonial Government", "Liberal Conservatism",
    "Liberal Feminism", "Liberalized Criminal State", "Liberal Internationalism", "Liberal Narodism",
    "Liberal Socialism", "Liberal Warlordism", "Longism", "Mambu Theology", "Managerial Technicracy",
    "Mazzinianesimo", "McCarthyism", "Meritocratic Liberalism", "Municipalism", "National Liberalism",
    "National Progressivism", "National Socialism", "Noirisme", "Oligarchism", "Organic Liberalism",
    "Pan-Somalism", "Pharaonism", "Popular Patriotism", "Populist Dixiecrats",
    "Post-Colonial Regionalism", "Progressive Democracy", "Radical Liberalism", "Radical Progressivism",
    "Reformed Belgicism", "Republican Pan-Africanism", "Republican Tribal Councilism", "Right Georgism",
    "Sardism", "Scandinavism", "Sicilianism", "Social Credit", "Socialist-Federalism",
    "Social Liberalism", "Spiritualism", "Teetotalism", "Tridemism", "True Whiggism",
    "Utopian Technocracy", "Venizelism"
  ] },
  { id: "marketLiberalism", name: "Market Liberalism", colour: "#e8e25a", subideologies: [
    "Agrarianism", "Anarcho-Capitalism", "Aulic Liberalism", "Authoritarian Liberalism", "Blasquismo",
    "Broad Paneuropeanism", "Capitalist Warlordism", "Centrism", "Christian Democracy",
    "Classical Liberalism", "Clientelism", "Costismo", "Dixiecrat", "Enlightened Conservatism",
    "Flemish Nationalism", "Free Market Capitalism", "Futuriblesisme", "Hamiltonianism",
    "Humanistic Capitalism", "Islamic Democracy", "Jadidism", "Jeffersonianism", "Kemalism",
    "Kleptocracy", "Kotahitanga", "Kritarchy", "Lerrouxismo", "Liberal Conservatism", "Liberal Feminism",
    "Liberal Internationalism", "Liberalism of the Spirit", "Liberalized Austropopulism",
    "Libertarianism", "Market Liberalism", "Mercantile Colonial Government", "Mercantile Criminal State",
    "Mercenary Democracy", "Minarchism", "National Liberalism", "Nupela Pasin", "Objectivism",
    "Oligarchism", "Organic Liberalism", "Pan-Asianism", "Pan-Somalism", "Pharaonism", "Police State",
    "Popular Patriotism", "Populist Dixiecrats", "Progressive Democracy", "Qualunquismo",
    "Radical Liberalism", "Radical Progressivism", "Reformed Belgicism", "Republican Pan-Africanism",
    "Republican Tribal Councilism", "Right Georgism", "Scandinavism", "Theodemocracy", "Toryism",
    "Tridenism", "True Whiggism", "Venizelism", "Weberian Liberalism", "Whiggism"
  ] },
  { id: "socialConservatism", name: "Social Conservatism", colour: "#5aa9e6", subideologies: [
    "Agrarianism", "Austropopulism", "Bonapartism", "Broad Paneuropeanism", "Castilhismo", "Chösid Nyi",
    "Christian Democracy", "Christian Technocracy", "Clientelism", "Coconutism",
    "Conservative Colonial Government", "Conservative Feminism", "Conservative Populism",
    "Conservative Warlordism", "Cossack Democracy", "Costa Rican Nationalism", "Costismo", "Dixiecrat",
    "Elective Monarchy", "Esotericism", "European Pan-Africanism", "Gaullism", "Hamiltonianism",
    "Hearstian Democracy", "Herrismo", "Hilozoísmo", "Humanisme Intégral", "Imaginism",
    "Integral Federalism", "Islamism", "Jadidism", "Kimbanguism", "Kritarchy", "Liberal Conservatism",
    "Longism", "Maurism", "Maurrassisme", "Mercenary Democracy", "Moderate Authoritarianism",
    "National Conservatism", "National Democracy", "Négritude", "Neo-Confucianism", "Neo-Feudalism",
    "Noucentisme", "Nupela Pasin", "Oligarchism", "Optimal System", "Pan-Somalism", "Paternal Socialism",
    "Pelleyism", "Popularism", "Popular Patriotism", "Populist Dixiecrats", "Post-Colonial Regionalism",
    "Progressive Conservatism", "Progressive Democracy", "Prussian Constitutionalism", "Qadimism",
    "Reformed Belgicism", "Republican Pan-Africanism", "Republican Tribal Councilism", "Right Georgism",
    "Scandinavism", "Sidonismo", "Social Conservatism", "Spiritualism", "Synarchism", "Theocracy",
    "Theodemocracy", "Theosophy", "Toryism", "Tribal Paternalism", "Tridemism", "True Whiggism",
    "Ukrainian Conservatism", "Ulmanism", "Whiggism", "Yugoslavism"
  ] },
  { id: "authoritarianDemocracy", name: "Authoritarian Democracy", colour: "#5b6fb5", subideologies: [
    "Absolute Monarchy", "Agrarianism", "Antarctic Expedition", "Austropopulism",
    "Authoritarian Christian Democracy", "Authoritarian Democracy", "Authoritarian Liberalism",
    "Authoritarian Warlordism", "Boer Nationalism", "Bolivarianism", "Bonapartism", "Burkhanism",
    "Cariato", "Carlism", "Caudillo Populism", "Centrism", "Chösid Nyi", "Christian Crusade",
    "Christian Personalism", "Coconutism", "Colonial Government", "Conservative Feminism",
    "Corporatocracy", "Cossack Democracy", "Cossack Dictatorship", "Costismo", "Dixiecrat",
    "Esotericism", "Estado Novo", "Eurasianism", "Flemish Nationalism", "Gaullism", "Gustavianism",
    "Hamiltonianism", "Hearstian Democracy", "Hispanism", "Humanistic Capitalism", "Integral Federalism",
    "Integrism", "Islamism", "Jacksonianism", "Kemalism", "Kimbanguism", "Kleptocracy", "Kritarchy",
    "Libertarianism", "Longism", "Marhaenism", "Maurism", "Maurrassisme", "Mercenary Democracy",
    "Military Junta", "Monarcho-Socialism", "National Conservatism", "National Democracy",
    "National Democracy (Bohemia)", "National Democracy (Poland)", "Neo-Confucianism", "Noucentisme",
    "Oligarchism", "Pan-Asianism", "Pan-Celticism", "Pan-Somalism", "Pelleyism", "Peronism",
    "Pirate Republic", "Police State", "Populist Dixiecrat", "Poujadisme", "Prussian Constitutionalism",
    "Qadimism", "Qualunquismo", "Red-Tinted Autocracy", "Rejuvenated Prussianism",
    "Republican Pan-Africanism", "Révolution Nationale", "Right Georgism", "Right Pan-Africanism",
    "Right Syndicalism", "Rocquisme", "Roerichism", "Savinkovism", "Scandinavism", "Security State",
    "Social Credit", "Social Machine", "Social Nationalism", "Soldiers Without Borders", "Solidarism",
    "Spiritualism", "Technocracy", "Teetotalism", "Theodemocracy", "Theosophy", "Toryism",
    "Tribal Paternalism", "Tridemism", "Ukrainian Conservatism", "Ulmanism", "Ustaše", "Vlasovism",
    "Washingtonian Paternalism", "Yali-Gurek Theology"
  ] },
  { id: "paternalAutocracy", name: "Paternal Autocracy", colour: "#8a7f72", subideologies: [
    "Absolute Monarchy", "Afrofuturism", "Agrarianism", "Anarcho-Capitalism", "Anthroposophy",
    "Aranaism", "Austropopulism", "Authoritarian Liberalism", "Authoritarian Christian Democracy",
    "Autocratic Colonial Government", "Autocratic Warlordism", "Belgicism", "Boer Nationalism",
    "Bolivarianism", "Bonapartism", "Carlism", "Caudillo Populism", "Chösid Nyi", "Christian Crusade",
    "Christian Personalism", "Clientelism", "Coconutism", "Conservative Feminism", "Corporatocracy",
    "Cossack Dictatorship", "Costismo", "Criminal State", "Duplessism", "Elective Monarchy",
    "Esotericism", "Flemish Nationalism", "Gaullism", "Getulismo", "Grinchism", "Gustavianism",
    "Hearstian Democracy", "Heel-Nederlandisme", "Hilozoísmo", "Hispanism", "Hussitism", "Imaginism",
    "Integral Federalism", "Integrism", "Islamism", "Jacksonianism", "Kalergite Paneuropeanism",
    "Kimbanguism", "Kleptocracy", "Kotahitanga", "Kritarchy", "Laurismo", "Legionarism", "Longism",
    "Macedonian Federalism", "Mafioso Socialism", "Maurism", "Maurrassisme", "Metaxism",
    "Military Dictatorship", "Minarchism", "National Conservatism", "National Democracy (Bohemia)",
    "National Democracy (Poland)", "Neoborbonismo", "Neo-Confucianism", "Neo-Feudalism",
    "Neo-Porfiriatoismo", "Nuevo Ideal Nacional", "Oligarchism", "Pan-Asianism", "Pan-Somalism",
    "Paternal Autocracy", "Pelleyism", "Pirate Republic", "Police State", "Popularism",
    "Popular Patriotism", "Poujadisme", "Prussian Constitutionalism", "Qadimism", "Red-Tinted Autocracy",
    "Révolution Nationale", "Right Georgism", "Right Pan-Africanism", "Right Syndicalism", "Rocquisme",
    "Roerichism", "Savinkovism", "Scandinavism", "Scientific Monarchism", "Security State",
    "Social Credit", "Solidarism", "Socialismo Militar", "Spectral State", "Snow Miserism", "Synarchism",
    "Technocracy", "Terrismo", "Teutonic Revivalism", "Theocracy", "Theodemocracy", "Theosophy",
    "Toryism", "Tribal Paternalism", "Tridemism", "Trujillato", "Ukrainian Conservatism", "Universism",
    "Vapsism", "Völkism", "Washingtonian Paternalism", "Whiggism", "Yan Xishan Thought", "Yugoslavism"
  ] },
  { id: "nationalPopulism", name: "National Populism", colour: "#6b4226", subideologies: [
    "Afrofuturism", "Agrarianism", "Anarcho-Totalitarianism", "Anthroposophy", "Ariokatholizismus",
    "Ariosophy", "Austropopulism", "Auténtico", "Authenticité", "Balli Kombëtar", "Belgicism",
    "Black Hebrew Israelism", "Boer Nationalism", "Bolivarianism", "Bonapartism", "British Israelism",
    "Burkhanism", "Caodaism", "Carlism", "Chauvinistic Colonial Government", "Chösid Nyi", "Coconutism",
    "Conservative Feminism", "Consistent Way", "Corporatocracy", "Cossack Dictatorship",
    "Credo Legionario", "Crnogoroslavlje", "Cultured Magic", "Deutscher Glaube", "Dionysian Yoga",
    "Esotericism", "Evolian Thought", "Flemish Nationalism", "Fundamentalism", "God Knowers",
    "Göringist Nationalism", "Great Way", "Heel-Nederlandisme", "Hilozoísmo", "Hindutva", "Hispanism",
    "Hoahaoism", "Humanisme Intégral", "Ilminism", "Indigenous Communitarianism", "Integralism",
    "Integrism", "Islamic Black Nationalism", "Islamism", "Italian Legionarism",
    "Italian Right Futurism", "Jacksonianism", "Jeffersonianism", "Kadroism", "Kimbanguism",
    "Klan Nationalism", "Kleptocracy", "Korpela Movement", "Kristliche Lehre", "Kritarchy", "Kryvianism",
    "Lapuanliike", "Legionarism", "Leopardism", "Lepénisme", "Lovecraftism", "Maciànismo",
    "Manhem Nordicism", "Mathengeism", "Maurrassisme", "Militant Atheism", "Military Stratocracy",
    "Monopolized Anarchism", "Moorish Science Temple", "Muertismo", "Misteryism", "Nacionalismo",
    "Nacismo", "National Basedism", "National Conservatism", "Nationalism-Maximalism",
    "Nationalist Warlordism", "National Populism", "National Radicalism", "National Restorationism",
    "National Security State", "Nation of Islam", "Neo-Confucianism", "Neo-Feudalism",
    "Neokonservatismus", "Néo-Maurrassisme", "Neo-Rexurdimento", "Noirisme", "Noirisme Éthéré",
    "Nordicism", "Oligarchism", "Padre Pio Thought", "Pan-Asianism", "Pan-Celticism", "Panchayat System",
    "Pan-Iranism", "Pan-Somalism", "Pan-Turkism", "Paranoiac-Critical Surrealism", "Pelleyism",
    "Phalangism", "Pirate Republic", "Popular Patriotism", "Possedism", "Post-Colonial Regionalism",
    "Poujadisme", "Providential Washingtonianism", "Reformed Belgicism", "Republican Tribal Councilism",
    "Révolution Nationale", "Rexism", "Right Pan-Africanism", "Right Paneuropeanism",
    "Right Syndicalism", "Riksvitalism", "Roerichism", "Savinkovism", "Scandinavism", "Scientology",
    "Scythianism", "Shintaisei", "Sicilianism", "Social Credit", "Socialist Falange",
    "Soldiers Without Borders", "Solidarism", "Spiritualism", "Synarchism", "Syrian Social Nationalism",
    "Taarausk", "Tagarab Theology", "Technocracy", "Teutonic Revivalism", "Theodemocracy", "Theosophy",
    "Toryism", "Townerism", "Toy Santaism", "Tribal Paternalism", "Tridenism", "True Whiggism",
    "Trujillato", "Tseghakronism", "Ukrainian Nationalism", "Universism", "Vapsism", "Vasconcelosismo",
    "Vibrantism", "Völkisch Communitarianism", "Völkism", "Wandervogel", "Yugoslavism"
  ] },
];

const IDEOLOGY_BY_KEY = new Map(
  IDEOLOGIES.flatMap((ideology) => [
    [ideology.id.toLowerCase(), ideology],
    [ideology.name.toLowerCase(), ideology],
  ]),
);

// The ideology an id or a display name stands for, or null.
export const findIdeology = (value) => IDEOLOGY_BY_KEY.get(String(value ?? "").trim().toLowerCase()) ?? null;

// Whether a subideology is one of its ideology's listed names. One that is not
// is still kept and shown, marked, rather than dropped or forced onto a near name.
export const isListedSubideology = (ideologyId, subideology) => {
  const ideology = findIdeology(ideologyId);
  const name = String(subideology ?? "").trim().toLowerCase();
  return Boolean(ideology && name && ideology.subideologies.some((entry) => entry.toLowerCase() === name));
};

// Sorted in this order in the tab: who governs first, the outlawed last.
export const PARTY_ROLES = ["governing", "coalition", "opposition", "extraParliamentary", "underground", "exile", "banned"];
export const PARTY_ROLE_LABELS = {
  governing: "Governing",
  coalition: "Coalition partner",
  opposition: "Opposition",
  extraParliamentary: "Outside parliament",
  underground: "Underground",
  exile: "In exile",
  banned: "Banned",
};

export const MAX_PARTIES = 16;

const text = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const wholeNumber = (value, max) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(max, Math.round(number)) : null;
};

const normalizeParty = (value) => {
  if (!value || typeof value !== "object") return null;
  const nameEn = text(value.nameEn);
  const nameNative = text(value.nameNative);
  if (!nameEn && !nameNative) return null;
  const ideology = findIdeology(value.ideology);
  const colour = /^#[0-9a-f]{6}$/i.test(text(value.colour)) ? text(value.colour).toLowerCase() : ideology?.colour ?? "#94a3b8";
  return {
    nameEn: nameEn || nameNative,
    nameNative: nameNative || nameEn,
    abbrEn: text(value.abbrEn, 16),
    abbrNative: text(value.abbrNative, 16),
    ideology: ideology?.id ?? "",
    subideology: text(value.subideology, 80),
    leader: text(value.leader),
    colour,
    role: PARTY_ROLES.includes(value.role) ? value.role : "opposition",
    seats: wholeNumber(value.seats, 100000),
    support: wholeNumber(value.support, 100),
    founded: text(value.founded, 40),
    description: text(value.description, 240),
  };
};

const partyOrder = (a, b) =>
  PARTY_ROLES.indexOf(a.role) - PARTY_ROLES.indexOf(b.role)
  || (b.seats ?? -1) - (a.seats ?? -1)
  || (b.support ?? -1) - (a.support ?? -1);

// One polity's entry, or null when it carries nothing to show.
export const normalizePoliticalLandscape = (value) => {
  if (!value || typeof value !== "object") return null;
  const parties = (Array.isArray(value.parties) ? value.parties : [])
    .map(normalizeParty)
    .filter(Boolean)
    .slice(0, MAX_PARTIES)
    .sort(partyOrder);
  const government = text(value.government);
  if (!parties.length && !government) return null;
  const seats = wholeNumber(value.legislatureSeats, 100000);
  return {
    asOf: text(value.asOf, 40),
    government,
    headOfState: text(value.headOfState),
    headOfGovernment: text(value.headOfGovernment),
    legislature: text(value.legislature),
    legislatureSeats: seats || null,
    nextElection: text(value.nextElection, 80),
    kind: value.kind === "factions" ? "factions" : "parties",
    parties,
  };
};

// world.politics: name-keyed like world.intelligence.
export const normalizePolitics = (value) =>
  Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {})
      .map(([polity, entry]) => [text(polity), normalizePoliticalLandscape(entry)])
      .filter(([polity, entry]) => polity && entry),
  );

// --- Turns: impacts.partyOps -------------------------------------------------
// An event that changes a polity's parties carries one op per change:
//   { polity, op: "update", party, changes }   a party's leader, seats, support, role...
//   { polity, op: "add", changes }             a new party (changes is the whole party)
//   { polity, op: "remove", party }            dissolved, merged away
//   { polity, op: "government", changes }      head of state/government, next election...
// Only a polity whose list has been compiled is changed: with no list there is
// nothing to keep in step, and a party added to nothing would stand for a whole
// system the model never described.
export const PARTY_OPS = ["update", "add", "remove", "government"];
const PARTY_FIELDS = ["nameEn", "nameNative", "abbrEn", "abbrNative", "ideology", "subideology", "leader", "colour", "role", "seats", "support", "founded", "description"];
const GOVERNMENT_FIELDS = ["government", "headOfState", "headOfGovernment", "legislature", "legislatureSeats", "nextElection", "kind"];

export const normalizePartyOp = (value) => {
  if (!value || typeof value !== "object") return null;
  const polity = text(value.polity);
  const op = text(value.op);
  if (!polity || !PARTY_OPS.includes(op)) return null;
  const changes = value.changes && typeof value.changes === "object" ? value.changes : {};
  const allowed = op === "government" ? GOVERNMENT_FIELDS : PARTY_FIELDS;
  const kept = Object.fromEntries(allowed.filter((key) => changes[key] !== undefined && changes[key] !== null).map((key) => [key, changes[key]]));
  const party = text(value.party);
  if ((op === "update" || op === "remove") && !party) return null;
  if (op !== "remove" && !Object.keys(kept).length) return null;
  return { polity, op, ...(party ? { party } : {}), ...(op !== "remove" ? { changes: kept } : {}) };
};

const sameName = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();
const findPartyIndex = (parties, name) =>
  parties.findIndex((party) => [party.nameEn, party.nameNative, party.abbrEn, party.abbrNative].some((value) => value && sameName(value, name)));

// Applies a turn's ops to world.politics. Returns the new map plus what was
// applied and what was skipped (with why), for the debug log.
export const applyPartyOps = (politics, ops, { date = "" } = {}) => {
  const next = { ...(politics ?? {}) };
  const applied = [];
  const rejected = [];
  for (const raw of ops ?? []) {
    const op = normalizePartyOp(raw);
    if (!op) {
      rejected.push({ op: raw, reason: "malformed party op" });
      continue;
    }
    const key = Object.keys(next).find((polity) => sameName(polity, op.polity));
    if (!key) {
      rejected.push({ op, reason: `${op.polity} has no compiled party list` });
      continue;
    }
    const entry = next[key];
    const parties = [...entry.parties];
    let changed = { ...entry };
    if (op.op === "government") {
      changed = { ...changed, ...op.changes };
    } else if (op.op === "add") {
      if (findPartyIndex(parties, op.changes.nameEn || op.changes.nameNative) >= 0) {
        rejected.push({ op, reason: `${op.changes.nameEn || op.changes.nameNative} is already listed` });
        continue;
      }
      parties.push(op.changes);
    } else {
      const index = findPartyIndex(parties, op.party);
      if (index < 0) {
        rejected.push({ op, reason: `${key} has no party called ${op.party}` });
        continue;
      }
      if (op.op === "remove") parties.splice(index, 1);
      else parties[index] = { ...parties[index], ...op.changes };
    }
    const normalized = normalizePoliticalLandscape({ ...changed, parties, asOf: date || entry.asOf });
    if (!normalized) {
      rejected.push({ op, reason: `the change would leave ${key} with nothing to show` });
      continue;
    }
    next[key] = normalized;
    applied.push({ ...op, polity: key });
  }
  return { politics: next, applied, rejected };
};

// Whether an election is due by `date` (the game's YYYY-MM-DD). nextElection
// is free text: a full date, a year and month, or a year somewhere in it
// ("2028", "by September 2027" reads as 2027). -> "overdue" | "this year" | "".
export const electionDue = (nextElection, date) => {
  const today = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(date));
  const when = text(nextElection);
  if (!today || !when) return "";
  const full = /\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/.exec(when);
  if (full) {
    const due = `${full[1]}-${full[2]}-${full[3] || "01"}`;
    if (due <= today[0]) return "overdue";
    return full[1] === today[1] ? "this year" : "";
  }
  const year = /\b(\d{4})\b/.exec(when)?.[1];
  if (!year) return "";
  if (year < today[1]) return "overdue";
  return year === today[1] ? "this year" : "";
};

// A person's name without the office a list writes after it:
// "Andrej Plenković, Prime Minister" -> "Andrej Plenković".
const personOf = (value) => text(value).split(",")[0].trim();
const foldPerson = (value) => personOf(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// A standard stat sheet names one leader. When a government op changes the
// head of government or of state, and the sheet still names the one replaced,
// the sheet follows, so the Stats tab and the Politics tab tell one story.
// A sheet naming somebody else (a monarch, a junta chief) is left alone, and a
// custom sheet has no leader to change.
//   -> { countryStats, changed: [{ polity, from, to }] }
export const leadersAfterGovernmentChange = (before, after, countryStats) => {
  const changed = [];
  const next = { ...(countryStats ?? {}) };
  for (const [polity, entry] of Object.entries(after ?? {})) {
    const prior = before?.[polity];
    const sheet = next[polity];
    if (!prior || !sheet || typeof sheet.leader !== "string" || !foldPerson(sheet.leader)) continue;
    for (const field of ["headOfGovernment", "headOfState"]) {
      if (!prior[field] || !entry[field] || foldPerson(prior[field]) === foldPerson(entry[field])) continue;
      if (foldPerson(sheet.leader) !== foldPerson(prior[field])) continue;
      const to = sheet.leader.includes(",") ? entry[field] : personOf(entry[field]);
      changed.push({ polity, from: sheet.leader, to });
      next[polity] = { ...sheet, leader: to };
      break;
    }
  }
  return { countryStats: next, changed };
};

// What the simulator is shown of the compiled lists, one line per party.
// `date` is the game's date, so an election that has fallen due is flagged.
export const describePoliticsForPrompt = (politics, { date = "" } = {}) => {
  const entries = Object.entries(politics ?? {});
  if (!entries.length) return "";
  const lines = entries.map(([polity, entry]) => {
    const head = [entry.government, entry.headOfState && `head of state ${entry.headOfState}`, entry.headOfGovernment && `head of government ${entry.headOfGovernment}`,
      entry.legislatureSeats && `${entry.legislature || "legislature"} ${entry.legislatureSeats} seats`, entry.nextElection && `next election ${entry.nextElection}`]
      .filter(Boolean).join("; ");
    const due = electionDue(entry.nextElection, date);
    const flag = due === "overdue" ? " — ELECTION DUE NOW: hold it in this turn"
      : due === "this year" ? " — election due this year: hold it if its date falls in this turn" : "";
    const parties = entry.parties.map((party) => {
      const ideology = findIdeology(party.ideology)?.name || "unclassified";
      const size = [party.seats !== null && entry.legislatureSeats ? `${party.seats} seats` : "", party.support !== null ? `${party.support}%` : ""].filter(Boolean).join(", ");
      const names = [...new Set([party.nameEn, party.nameNative])].join(" / ");
      const abbrs = [...new Set([party.abbrEn, party.abbrNative].filter(Boolean))].join(" / ");
      return `  - ${names}${abbrs ? ` (${abbrs})` : ""}: ${PARTY_ROLE_LABELS[party.role]}, ${ideology} / ${party.subideology || "-"}, leader ${party.leader || "unknown"}${size ? `, ${size}` : ""}`;
    });
    return `${polity}: ${head}${flag}\n${parties.join("\n")}`;
  });
  return `[Political Parties]
The parties of the polities below are tracked (Stats → Politics). When an event changes them, the same event carries impacts.partyOps, one entry per change; an event that only narrates the change leaves the list wrong. An election moves seats and support for every party that gained or lost (an update op each) and may change the governing role, heads of government and the next election date (a government op). A new leader, a split, a merger, a ban or legalisation, a party founded or dissolved: each is an op. Name the party as it is listed below. An election whose date falls in the period you write is held in it: an event with the result, an update op for every party whose seats or support moved, and a government op with the next election date. A renamed party is one update op that carries all four new names — nameEn, nameNative, abbrEn and abbrNative — never the English name alone. nameNative is the name as native speakers would write it: correct grammar and agreement, real words (never a near-sounding wrong one), and that language's capitalisation rules (e.g. Croatian capitalises only the first word and proper nouns: Hrvatski kršćanski konzervativci) — not a word-for-word gloss; abbrNative abbreviates it.
  {"polity":"<listed polity>","op":"update","party":"<listed name or abbreviation>","changes":{"leader":"","role":"governing|coalition|opposition|extraParliamentary|underground|exile|banned","seats":0,"support":0,"ideology":"","subideology":"","...":"only the fields that changed"}}
  {"polity":"<listed polity>","op":"update","party":"<listed name>","changes":{"nameEn":"","nameNative":"","abbrEn":"","abbrNative":""}}
  {"polity":"<listed polity>","op":"add","changes":{"nameEn":"","nameNative":"","abbrEn":"","abbrNative":"","ideology":"one of the ten","subideology":"","leader":"","role":"","seats":0,"support":0,"founded":""}}
  {"polity":"<listed polity>","op":"remove","party":"<listed name>"}
  {"polity":"<listed polity>","op":"government","changes":{"government":"","headOfState":"","headOfGovernment":"","legislatureSeats":0,"nextElection":""}}
Ideologies: ${IDEOLOGIES.map((ideology) => ideology.name).join(", ")}. Only these polities; never emit partyOps for one not listed.
${lines.join("\n")}`;
};

// The list the model chooses from, one line per ideology.
export const ideologyListText = () =>
  IDEOLOGIES.map((ideology) => `${ideology.name}: ${ideology.subideologies.join("; ")}`).join("\n");
