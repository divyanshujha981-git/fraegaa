import './App.css';
import { NavBar } from './other_assets/NavBar/nav_bar.jsx';
import {BrowserRouter, Route, Routes} from 'react-router-dom';
import { AllGamesPage } from './other_assets/all_game_page/all_game_page.jsx';
import { HouseBlock } from './individual_games/house_block/house_block.jsx';
import { PreGameDefinitionHouseBlock } from './individual_games/house_block/pre_game_definition.jsx';
import {PreGameDefinitionMiniKingdom} from "./individual_games/mini_kingdom/pre_game_definition__mini_kingdom.jsx";
import {MiniKingdom} from "./individual_games/mini_kingdom/mini_kingdom.jsx";

function App() {
  return (
      <BrowserRouter>
        <NavBar />
        <Routes>

            <Route path="/" element={<AllGamesPage />} />

            <Route path="/houseblock" element={<HouseBlock />} />
            <Route path="/minikingdom" element={<MiniKingdom />} />

            <Route path="/houseblock/pregame_definition" element={<PreGameDefinitionHouseBlock />} />
            <Route path="/minikingdom/pregame_definition" element={<PreGameDefinitionMiniKingdom />} />

        </Routes>
      </BrowserRouter>
  );
}

export default App;
