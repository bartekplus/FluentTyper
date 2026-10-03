// Common French first names that only one gender bears, for agreement with a name subject
// ("Martine est contente", "Antoine est fatigué"). Names borne by either gender (Camille,
// Dominique, Claude, Sacha) and names that are also common nouns (Rose, Jade, Ambre, Victoire,
// Constance) are left out.
import type { Gender } from "./frenchLexicon";

const FEMININE = (
  "Marie Anne Sophie Catherine Isabelle Nathalie Sylvie Martine Christine Françoise Monique " +
  "Nicole Valérie Sandrine Céline Julie Aurélie Émilie Claire Laura Léa Chloé Manon Emma Inès " +
  "Louise Alice Juliette Lucie Zoé Anaïs Mathilde Pauline Sarah Charlotte Margaux Clara Élodie " +
  "Caroline Hélène Brigitte Patricia Véronique Florence Agnès Jeanne Madeleine Simone Danielle " +
  "Jacqueline Odile Élise Amélie Laure Marion Océane Mélanie Virginie Stéphanie Karine Delphine " +
  "Laetitia Audrey Vanessa Elsa Agathe Margot Romane Anna Eva Nina Béatrice Bernadette " +
  "Geneviève Thérèse Yvonne Colette Paulette Marguerite Ginette Sabine Corinne Muriel Pascale " +
  "Joëlle Mireille Annie Chantal Évelyne Josette Denise Suzanne Gisèle Liliane Noémie Justine " +
  "Léonie Gabrielle Valentine Héloïse Ophélie Estelle Morgane Julia Marine Cécile Nadine " +
  "Maryse Solène Adèle Lisa Léna Sylviane Annick Fabienne Christelle Laurence"
).split(" ");

const MASCULINE = (
  "Antoine Pierre Jean Paul Jacques Michel Philippe Alain Bernard Patrick Nicolas Christophe " +
  "François Daniel Éric Laurent Olivier Thierry Pascal Stéphane Sébastien Julien David " +
  "Frédéric Thomas Alexandre Guillaume Mathieu Vincent Maxime Hugo Lucas Louis Gabriel Arthur " +
  "Jules Léo Raphaël Adam Nathan Théo Martin Victor Clément Romain Benjamin Quentin Kevin " +
  "Florian Jérôme Didier Gérard René Robert Roger Marcel André Henri Georges Charles Joseph Marc " +
  "Luc Yves Serge Denis Bruno Gilles Hervé Franck Fabrice Cédric Arnaud Damien Ludovic Anthony " +
  "Jonathan Jérémy Adrien Baptiste Bastien Valentin Simon Samuel Benoît Xavier Yann Rémi Fabien " +
  "Grégory Loïc Matthieu Raymond Étienne Emmanuel Jean-Pierre Jean-Paul Jean-Marc Jean-Luc " +
  "Jean-Claude Jean-Marie Jean-François Jean-Michel Jean-Jacques Lucien Gaston Albert Fernand " +
  "Maurice Émile Gustave Édouard Alexis Mathis Enzo Tristan Bertrand Gaël Yannick Sylvain"
).split(" ");

const GENDERS = new Map<string, Gender>([
  ...MASCULINE.map((name): [string, Gender] => [name, "m"]),
  ...FEMININE.map((name): [string, Gender] => [name, "f"]),
]);

/** The gender of a first name as typed ("Martine" -> "f"), or null when it is not listed. */
export function firstNameGender(name: string): Gender | null {
  return GENDERS.get(name) ?? null;
}
