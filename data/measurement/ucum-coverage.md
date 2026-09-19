# UCUM atomic-code coverage

Generated from the pinned, unmodified UCUM 2.2 essence snapshot. This is a coverage audit, not a UCUM parser or a conformance claim. UCUM expression syntax and case-insensitive aliases are intentionally unsupported.

Snapshot SHA-256: `dfccea1b5dc284245ebae97edd1dc03c45864da4e87df55bc9851797b4fd0b61`

| recognized-safe | recognized-ambiguous | unsupported | total |
| --------------: | -------------------: | ----------: | ----: |
|              42 |                   32 |         238 |   312 |

| UCUM code         | classification       | reason / prose symbol                                                 |
| ----------------- | -------------------- | --------------------------------------------------------------------- |
| `m`               | recognized-safe      | prose symbol m                                                        |
| `s`               | recognized-safe      | prose symbol s                                                        |
| `g`               | recognized-safe      | prose symbol g                                                        |
| `rad`             | recognized-ambiguous | radian or rad absorbed-dose unit                                      |
| `K`               | recognized-ambiguous | single capital symbol K: preserved standalone, available in compounds |
| `C`               | recognized-ambiguous | single capital symbol C: preserved standalone, available in compounds |
| `cd`              | recognized-safe      | prose symbol cd                                                       |
| `10*`             | unsupported          | not in prose registry                                                 |
| `10^`             | unsupported          | not in prose registry                                                 |
| `[pi]`            | unsupported          | not in prose registry                                                 |
| `%`               | unsupported          | not in prose registry                                                 |
| `[ppth]`          | unsupported          | not in prose registry                                                 |
| `[ppm]`           | unsupported          | not in prose registry                                                 |
| `[ppb]`           | unsupported          | not in prose registry                                                 |
| `[pptr]`          | unsupported          | not in prose registry                                                 |
| `mol`             | recognized-safe      | prose symbol mol                                                      |
| `sr`              | recognized-safe      | prose symbol sr                                                       |
| `Hz`              | recognized-safe      | prose symbol Hz                                                       |
| `N`               | recognized-ambiguous | single capital symbol N: preserved standalone, available in compounds |
| `Pa`              | recognized-ambiguous | kinship word in supported locales                                     |
| `J`               | recognized-ambiguous | single capital symbol J: preserved standalone, available in compounds |
| `W`               | recognized-ambiguous | single capital symbol W: preserved standalone, available in compounds |
| `A`               | recognized-ambiguous | single capital symbol A: preserved standalone, available in compounds |
| `V`               | recognized-ambiguous | single capital symbol V: preserved standalone, available in compounds |
| `F`               | recognized-ambiguous | single capital symbol F: preserved standalone, available in compounds |
| `Ohm`             | recognized-safe      | prose symbol Ω                                                        |
| `S`               | recognized-ambiguous | single capital symbol S: preserved standalone, available in compounds |
| `Wb`              | recognized-safe      | prose symbol Wb                                                       |
| `Cel`             | recognized-safe      | prose symbol °C                                                       |
| `T`               | recognized-ambiguous | single capital symbol T: preserved standalone, available in compounds |
| `H`               | recognized-ambiguous | single capital symbol H: preserved standalone, available in compounds |
| `lm`              | recognized-safe      | prose symbol lm                                                       |
| `lx`              | recognized-safe      | prose symbol lx                                                       |
| `Bq`              | recognized-safe      | prose symbol Bq                                                       |
| `Gy`              | recognized-safe      | prose symbol Gy                                                       |
| `Sv`              | recognized-safe      | prose symbol Sv                                                       |
| `gon`             | unsupported          | not in prose registry                                                 |
| `deg`             | recognized-ambiguous | angular symbols are printed directly after the number                 |
| `'`               | recognized-ambiguous | angular symbols are printed directly after the number                 |
| `''`              | unsupported          | not in prose registry                                                 |
| `l`               | recognized-safe      | prose symbol l                                                        |
| `L`               | recognized-ambiguous | single capital symbol L: preserved standalone, available in compounds |
| `ar`              | recognized-ambiguous | common article and year symbol                                        |
| `min`             | recognized-safe      | prose symbol min                                                      |
| `h`               | recognized-safe      | prose symbol h                                                        |
| `d`               | recognized-safe      | prose symbol d                                                        |
| `a_t`             | unsupported          | not in prose registry                                                 |
| `a_j`             | unsupported          | not in prose registry                                                 |
| `a_g`             | unsupported          | not in prose registry                                                 |
| `a`               | unsupported          | not in prose registry                                                 |
| `wk`              | unsupported          | not in prose registry                                                 |
| `mo_s`            | unsupported          | not in prose registry                                                 |
| `mo_j`            | unsupported          | not in prose registry                                                 |
| `mo_g`            | unsupported          | not in prose registry                                                 |
| `mo`              | unsupported          | not in prose registry                                                 |
| `t`               | recognized-safe      | prose symbol t                                                        |
| `bar`             | recognized-safe      | prose symbol bar                                                      |
| `u`               | recognized-safe      | prose symbol u                                                        |
| `eV`              | recognized-safe      | prose symbol eV                                                       |
| `AU`              | recognized-safe      | prose symbol au                                                       |
| `pc`              | recognized-safe      | prose symbol pc                                                       |
| `[c]`             | unsupported          | not in prose registry                                                 |
| `[h]`             | unsupported          | not in prose registry                                                 |
| `[k]`             | unsupported          | not in prose registry                                                 |
| `[eps_0]`         | unsupported          | not in prose registry                                                 |
| `[mu_0]`          | unsupported          | not in prose registry                                                 |
| `[e]`             | unsupported          | not in prose registry                                                 |
| `[m_e]`           | unsupported          | not in prose registry                                                 |
| `[m_p]`           | unsupported          | not in prose registry                                                 |
| `[G]`             | unsupported          | not in prose registry                                                 |
| `[g]`             | unsupported          | not in prose registry                                                 |
| `atm`             | recognized-safe      | prose symbol atm                                                      |
| `[ly]`            | unsupported          | not in prose registry                                                 |
| `gf`              | unsupported          | not in prose registry                                                 |
| `[lbf_av]`        | unsupported          | not in prose registry                                                 |
| `Ky`              | unsupported          | not in prose registry                                                 |
| `Gal`             | recognized-safe      | prose symbol Gal                                                      |
| `dyn`             | recognized-safe      | prose symbol dyn                                                      |
| `erg`             | recognized-safe      | prose symbol erg                                                      |
| `P`               | recognized-ambiguous | single capital symbol P: preserved standalone, available in compounds |
| `Bi`              | unsupported          | not in prose registry                                                 |
| `St`              | recognized-safe      | prose symbol St                                                       |
| `Mx`              | recognized-safe      | prose symbol Mx                                                       |
| `G`               | recognized-ambiguous | gauss or mobile network generation                                    |
| `Oe`              | recognized-safe      | prose symbol Oe                                                       |
| `Gb`              | unsupported          | not in prose registry                                                 |
| `sb`              | unsupported          | not in prose registry                                                 |
| `Lmb`             | unsupported          | not in prose registry                                                 |
| `ph`              | unsupported          | not in prose registry                                                 |
| `Ci`              | recognized-safe      | prose symbol Ci                                                       |
| `R`               | recognized-ambiguous | single capital symbol R: preserved standalone, available in compounds |
| `RAD`             | unsupported          | not in prose registry                                                 |
| `REM`             | recognized-ambiguous | radiation dose or CSS root-em length                                  |
| `[in_i]`          | recognized-ambiguous | common English preposition                                            |
| `[ft_i]`          | recognized-safe      | prose symbol ft                                                       |
| `[yd_i]`          | recognized-safe      | prose symbol yd                                                       |
| `[mi_i]`          | recognized-safe      | prose symbol mi                                                       |
| `[fth_i]`         | unsupported          | not in prose registry                                                 |
| `[nmi_i]`         | recognized-safe      | prose symbol nmi                                                      |
| `[kn_i]`          | recognized-safe      | prose symbol kn                                                       |
| `[sin_i]`         | unsupported          | not in prose registry                                                 |
| `[sft_i]`         | unsupported          | not in prose registry                                                 |
| `[syd_i]`         | unsupported          | not in prose registry                                                 |
| `[cin_i]`         | unsupported          | not in prose registry                                                 |
| `[cft_i]`         | unsupported          | not in prose registry                                                 |
| `[cyd_i]`         | unsupported          | not in prose registry                                                 |
| `[bf_i]`          | unsupported          | not in prose registry                                                 |
| `[cr_i]`          | unsupported          | not in prose registry                                                 |
| `[mil_i]`         | unsupported          | not in prose registry                                                 |
| `[cml_i]`         | unsupported          | not in prose registry                                                 |
| `[hd_i]`          | unsupported          | not in prose registry                                                 |
| `[ft_us]`         | unsupported          | not in prose registry                                                 |
| `[yd_us]`         | unsupported          | not in prose registry                                                 |
| `[in_us]`         | unsupported          | not in prose registry                                                 |
| `[rd_us]`         | unsupported          | not in prose registry                                                 |
| `[ch_us]`         | unsupported          | not in prose registry                                                 |
| `[lk_us]`         | unsupported          | not in prose registry                                                 |
| `[rch_us]`        | unsupported          | not in prose registry                                                 |
| `[rlk_us]`        | unsupported          | not in prose registry                                                 |
| `[fth_us]`        | unsupported          | not in prose registry                                                 |
| `[fur_us]`        | unsupported          | not in prose registry                                                 |
| `[mi_us]`         | unsupported          | not in prose registry                                                 |
| `[acr_us]`        | recognized-ambiguous | international or US survey acre                                       |
| `[srd_us]`        | unsupported          | not in prose registry                                                 |
| `[smi_us]`        | unsupported          | not in prose registry                                                 |
| `[sct]`           | unsupported          | not in prose registry                                                 |
| `[twp]`           | unsupported          | not in prose registry                                                 |
| `[mil_us]`        | unsupported          | not in prose registry                                                 |
| `[in_br]`         | unsupported          | not in prose registry                                                 |
| `[ft_br]`         | unsupported          | not in prose registry                                                 |
| `[rd_br]`         | unsupported          | not in prose registry                                                 |
| `[ch_br]`         | unsupported          | not in prose registry                                                 |
| `[lk_br]`         | unsupported          | not in prose registry                                                 |
| `[fth_br]`        | unsupported          | not in prose registry                                                 |
| `[pc_br]`         | unsupported          | not in prose registry                                                 |
| `[yd_br]`         | unsupported          | not in prose registry                                                 |
| `[mi_br]`         | unsupported          | not in prose registry                                                 |
| `[nmi_br]`        | unsupported          | not in prose registry                                                 |
| `[kn_br]`         | unsupported          | not in prose registry                                                 |
| `[acr_br]`        | unsupported          | not in prose registry                                                 |
| `[gal_us]`        | recognized-ambiguous | US and imperial gallons differ                                        |
| `[bbl_us]`        | unsupported          | not in prose registry                                                 |
| `[qt_us]`         | recognized-ambiguous | US and imperial quarts differ                                         |
| `[pt_us]`         | recognized-ambiguous | US and imperial pints differ                                          |
| `[gil_us]`        | unsupported          | not in prose registry                                                 |
| `[foz_us]`        | unsupported          | not in prose registry                                                 |
| `[fdr_us]`        | unsupported          | not in prose registry                                                 |
| `[min_us]`        | unsupported          | not in prose registry                                                 |
| `[crd_us]`        | unsupported          | not in prose registry                                                 |
| `[bu_us]`         | unsupported          | not in prose registry                                                 |
| `[gal_wi]`        | unsupported          | not in prose registry                                                 |
| `[pk_us]`         | unsupported          | not in prose registry                                                 |
| `[dqt_us]`        | unsupported          | not in prose registry                                                 |
| `[dpt_us]`        | unsupported          | not in prose registry                                                 |
| `[tbs_us]`        | unsupported          | not in prose registry                                                 |
| `[tsp_us]`        | unsupported          | not in prose registry                                                 |
| `[cup_us]`        | recognized-ambiguous | cup size is region-dependent                                          |
| `[foz_m]`         | unsupported          | not in prose registry                                                 |
| `[cup_m]`         | unsupported          | not in prose registry                                                 |
| `[tsp_m]`         | unsupported          | not in prose registry                                                 |
| `[tbs_m]`         | unsupported          | not in prose registry                                                 |
| `[gal_br]`        | unsupported          | not in prose registry                                                 |
| `[pk_br]`         | unsupported          | not in prose registry                                                 |
| `[bu_br]`         | unsupported          | not in prose registry                                                 |
| `[qt_br]`         | unsupported          | not in prose registry                                                 |
| `[pt_br]`         | unsupported          | not in prose registry                                                 |
| `[gil_br]`        | unsupported          | not in prose registry                                                 |
| `[foz_br]`        | unsupported          | not in prose registry                                                 |
| `[fdr_br]`        | unsupported          | not in prose registry                                                 |
| `[min_br]`        | unsupported          | not in prose registry                                                 |
| `[gr]`            | unsupported          | not in prose registry                                                 |
| `[lb_av]`         | recognized-ambiguous | avoirdupois or historical pound                                       |
| `[oz_av]`         | recognized-ambiguous | avoirdupois or troy ounce                                             |
| `[dr_av]`         | unsupported          | not in prose registry                                                 |
| `[scwt_av]`       | unsupported          | not in prose registry                                                 |
| `[lcwt_av]`       | unsupported          | not in prose registry                                                 |
| `[ston_av]`       | unsupported          | not in prose registry                                                 |
| `[lton_av]`       | unsupported          | not in prose registry                                                 |
| `[stone_av]`      | unsupported          | not in prose registry                                                 |
| `[pwt_tr]`        | unsupported          | not in prose registry                                                 |
| `[oz_tr]`         | unsupported          | not in prose registry                                                 |
| `[lb_tr]`         | unsupported          | not in prose registry                                                 |
| `[sc_ap]`         | unsupported          | not in prose registry                                                 |
| `[dr_ap]`         | unsupported          | not in prose registry                                                 |
| `[oz_ap]`         | unsupported          | not in prose registry                                                 |
| `[lb_ap]`         | unsupported          | not in prose registry                                                 |
| `[oz_m]`          | unsupported          | not in prose registry                                                 |
| `[lne]`           | unsupported          | not in prose registry                                                 |
| `[pnt]`           | unsupported          | not in prose registry                                                 |
| `[pca]`           | unsupported          | not in prose registry                                                 |
| `[pnt_pr]`        | unsupported          | not in prose registry                                                 |
| `[pca_pr]`        | unsupported          | not in prose registry                                                 |
| `[pied]`          | unsupported          | not in prose registry                                                 |
| `[pouce]`         | unsupported          | not in prose registry                                                 |
| `[ligne]`         | unsupported          | not in prose registry                                                 |
| `[didot]`         | unsupported          | not in prose registry                                                 |
| `[cicero]`        | unsupported          | not in prose registry                                                 |
| `[degF]`          | recognized-safe      | prose symbol °F                                                       |
| `[degR]`          | unsupported          | not in prose registry                                                 |
| `[degRe]`         | unsupported          | not in prose registry                                                 |
| `cal_[15]`        | unsupported          | not in prose registry                                                 |
| `cal_[20]`        | unsupported          | not in prose registry                                                 |
| `cal_m`           | unsupported          | not in prose registry                                                 |
| `cal_IT`          | unsupported          | not in prose registry                                                 |
| `cal_th`          | recognized-ambiguous | thermochemical and international-table calories differ                |
| `cal`             | unsupported          | not in prose registry                                                 |
| `[Cal]`           | unsupported          | not in prose registry                                                 |
| `[Btu_39]`        | unsupported          | not in prose registry                                                 |
| `[Btu_59]`        | unsupported          | not in prose registry                                                 |
| `[Btu_60]`        | unsupported          | not in prose registry                                                 |
| `[Btu_m]`         | unsupported          | not in prose registry                                                 |
| `[Btu_IT]`        | unsupported          | not in prose registry                                                 |
| `[Btu_th]`        | unsupported          | not in prose registry                                                 |
| `[Btu]`           | unsupported          | not in prose registry                                                 |
| `[HP]`            | recognized-ambiguous | multiple horsepower definitions                                       |
| `tex`             | unsupported          | not in prose registry                                                 |
| `[den]`           | unsupported          | not in prose registry                                                 |
| `m[H2O]`          | unsupported          | not in prose registry                                                 |
| `m[Hg]`           | unsupported          | not in prose registry                                                 |
| `[in_i'H2O]`      | unsupported          | not in prose registry                                                 |
| `[in_i'Hg]`       | unsupported          | not in prose registry                                                 |
| `[PRU]`           | unsupported          | not in prose registry                                                 |
| `[wood'U]`        | unsupported          | not in prose registry                                                 |
| `[diop]`          | unsupported          | not in prose registry                                                 |
| `[p'diop]`        | unsupported          | not in prose registry                                                 |
| `%[slope]`        | unsupported          | not in prose registry                                                 |
| `[mesh_i]`        | unsupported          | not in prose registry                                                 |
| `[Ch]`            | unsupported          | not in prose registry                                                 |
| `[drp]`           | unsupported          | not in prose registry                                                 |
| `[hnsf'U]`        | unsupported          | not in prose registry                                                 |
| `[MET]`           | unsupported          | not in prose registry                                                 |
| `[hp'_X]`         | unsupported          | not in prose registry                                                 |
| `[hp'_C]`         | unsupported          | not in prose registry                                                 |
| `[hp'_M]`         | unsupported          | not in prose registry                                                 |
| `[hp'_Q]`         | unsupported          | not in prose registry                                                 |
| `[hp_X]`          | unsupported          | not in prose registry                                                 |
| `[hp_C]`          | unsupported          | not in prose registry                                                 |
| `[hp_M]`          | unsupported          | not in prose registry                                                 |
| `[hp_Q]`          | unsupported          | not in prose registry                                                 |
| `[kp_X]`          | unsupported          | not in prose registry                                                 |
| `[kp_C]`          | unsupported          | not in prose registry                                                 |
| `[kp_M]`          | unsupported          | not in prose registry                                                 |
| `[kp_Q]`          | unsupported          | not in prose registry                                                 |
| `eq`              | unsupported          | not in prose registry                                                 |
| `osm`             | unsupported          | not in prose registry                                                 |
| `[pH]`            | unsupported          | not in prose registry                                                 |
| `g%`              | unsupported          | not in prose registry                                                 |
| `[S]`             | unsupported          | not in prose registry                                                 |
| `[HPF]`           | unsupported          | not in prose registry                                                 |
| `[LPF]`           | unsupported          | not in prose registry                                                 |
| `kat`             | recognized-safe      | prose symbol kat                                                      |
| `U`               | unsupported          | not in prose registry                                                 |
| `[iU]`            | unsupported          | not in prose registry                                                 |
| `[IU]`            | unsupported          | not in prose registry                                                 |
| `[arb'U]`         | unsupported          | not in prose registry                                                 |
| `[USP'U]`         | unsupported          | not in prose registry                                                 |
| `[GPL'U]`         | unsupported          | not in prose registry                                                 |
| `[MPL'U]`         | unsupported          | not in prose registry                                                 |
| `[APL'U]`         | unsupported          | not in prose registry                                                 |
| `[beth'U]`        | unsupported          | not in prose registry                                                 |
| `[anti'Xa'U]`     | unsupported          | not in prose registry                                                 |
| `[todd'U]`        | unsupported          | not in prose registry                                                 |
| `[dye'U]`         | unsupported          | not in prose registry                                                 |
| `[smgy'U]`        | unsupported          | not in prose registry                                                 |
| `[bdsk'U]`        | unsupported          | not in prose registry                                                 |
| `[ka'U]`          | unsupported          | not in prose registry                                                 |
| `[knk'U]`         | unsupported          | not in prose registry                                                 |
| `[mclg'U]`        | unsupported          | not in prose registry                                                 |
| `[tb'U]`          | unsupported          | not in prose registry                                                 |
| `[CCID_50]`       | unsupported          | not in prose registry                                                 |
| `[TCID_50]`       | unsupported          | not in prose registry                                                 |
| `[EID_50]`        | unsupported          | not in prose registry                                                 |
| `[PFU]`           | unsupported          | not in prose registry                                                 |
| `[FFU]`           | unsupported          | not in prose registry                                                 |
| `[CFU]`           | unsupported          | not in prose registry                                                 |
| `[IR]`            | unsupported          | not in prose registry                                                 |
| `[BAU]`           | unsupported          | not in prose registry                                                 |
| `[AU]`            | unsupported          | not in prose registry                                                 |
| `[Amb'a'1'U]`     | unsupported          | not in prose registry                                                 |
| `[PNU]`           | unsupported          | not in prose registry                                                 |
| `[Lf]`            | unsupported          | not in prose registry                                                 |
| `[D'ag'U]`        | unsupported          | not in prose registry                                                 |
| `[FEU]`           | unsupported          | not in prose registry                                                 |
| `[ELU]`           | unsupported          | not in prose registry                                                 |
| `[EU]`            | unsupported          | not in prose registry                                                 |
| `Np`              | unsupported          | not in prose registry                                                 |
| `B`               | unsupported          | not in prose registry                                                 |
| `B[SPL]`          | unsupported          | not in prose registry                                                 |
| `B[V]`            | unsupported          | not in prose registry                                                 |
| `B[mV]`           | unsupported          | not in prose registry                                                 |
| `B[uV]`           | unsupported          | not in prose registry                                                 |
| `B[10.nV]`        | unsupported          | not in prose registry                                                 |
| `B[W]`            | unsupported          | not in prose registry                                                 |
| `B[kW]`           | unsupported          | not in prose registry                                                 |
| `st`              | unsupported          | not in prose registry                                                 |
| `Ao`              | recognized-safe      | prose symbol Å                                                        |
| `b`               | recognized-ambiguous | common word and bit abbreviation                                      |
| `att`             | unsupported          | not in prose registry                                                 |
| `mho`             | unsupported          | not in prose registry                                                 |
| `[psi]`           | unsupported          | not in prose registry                                                 |
| `circ`            | unsupported          | not in prose registry                                                 |
| `sph`             | unsupported          | not in prose registry                                                 |
| `[car_m]`         | unsupported          | not in prose registry                                                 |
| `[car_Au]`        | unsupported          | not in prose registry                                                 |
| `[smoot]`         | unsupported          | not in prose registry                                                 |
| `[m/s2/Hz^(1/2)]` | unsupported          | not in prose registry                                                 |
| `[NTU]`           | unsupported          | not in prose registry                                                 |
| `[FNU]`           | unsupported          | not in prose registry                                                 |
| `bit_s`           | unsupported          | not in prose registry                                                 |
| `bit`             | recognized-safe      | prose symbol bit                                                      |
| `By`              | unsupported          | not in prose registry                                                 |
| `Bd`              | unsupported          | not in prose registry                                                 |
